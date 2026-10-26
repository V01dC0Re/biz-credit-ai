"""Explainable AI: превращаем JSON-решение в понятный текст для клиента.

Использует локальную OpenAI-совместимую LLM (gemma4:12b) на общем эндпоинте
http://10.154.0.1:8080/v1. Reasoning на сервере отключён, поэтому ответ сразу
приходит в поле `content`.
Если LLM недоступна или отвечает слишком долго — генерируем шаблонное
объяснение, чтобы сервис никогда не отдавал пустое поле ai_explanation.
"""

from __future__ import annotations

import logging
import re

import httpx

from .config import Settings
from .schemas import Decision, EvaluateRequest, KeyFactor, Offer

logger = logging.getLogger("scoring.llm")

SYSTEM_PROMPT = (
    "Ты — финансовый консультант банка для малого бизнеса. "
    "Объясняй решение простым русским языком, без банковского жаргона. "
    "Ровно 2–3 предложения. Не используй списки, заголовки и маркдаун."
)

_DECISION_INTRO = {
    Decision.APPROVED: "Хорошие новости: банк готов одобрить кредит",
    Decision.COUNTER_OFFER: "Банк готов помочь, но на скорректированных условиях",
    Decision.DOCS_REQUIRED: "Банку нужно чуть больше документов, чтобы принять решение",
    Decision.MANUAL_REVIEW: "Заявку проверит кредитный специалист",
    Decision.REJECTED: "К сожалению, сейчас банк не может одобрить эту заявку",
}


class LLMExplainer:
    """Генерирует короткое понятное объяснение решения."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.s = settings or Settings.from_env()
        self._client = httpx.Client(timeout=self.s.ai_timeout_seconds)

    def close(self) -> None:
        self._client.close()

    # ------------------------------------------------------------------ #
    def explain(self, req: EvaluateRequest, result: dict) -> str:
        """Основная точка входа: сначала LLM, при любой проблеме — шаблон."""
        try:
            text = self._ask_llm(req, result)
            if text:
                logger.info("LLM explanation received (model=%s)", self.s.ai_model)
                return self._clean(text)
        except Exception as exc:  # noqa: BLE001 - деградируем мягко
            logger.warning("LLM explanation failed, using template: %s", exc)
        return self._template(req, result)

    # ------------------------------------------------------------------ #
    def _ask_llm(self, req: EvaluateRequest, result: dict) -> str:
        payload = self._build_prompt(req, result)
        body = {
            "model": self.s.ai_model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": payload},
            ],
            "temperature": 0.3,
            "max_tokens": 220,
        }
        headers = {"Content-Type": "application/json"}
        if self.s.ai_api_key:
            headers["Authorization"] = f"Bearer {self.s.ai_api_key}"

        resp = self._client.post(
            f"{self.s.ai_base_url.rstrip('/')}/chat/completions",
            json=body,
            headers=headers,
        )
        resp.raise_for_status()
        data = resp.json()
        message = data["choices"][0]["message"]
        return (message.get("content") or "").strip()

    @staticmethod
    def _build_prompt(req: EvaluateRequest, result: dict) -> str:
        decision: Decision = result["decision"]
        offer: Offer | None = result.get("offer")
        factors: list[KeyFactor] = result.get("key_factors", [])

        parts = [
            f"Решение: {decision.value}",
            f"Запрошено: {req.requested_amount:,} ₽ на {req.requested_term_months} мес.",
            f"Чистая прибыль: {req.monthly_net_profit:,} ₽/мес, "
            f"долговая нагрузка DSTI: {result['dsti']:.0%}.",
        ]
        if offer is not None:
            parts.append(
                f"Условия банка: {offer.amount:,} ₽ на {offer.term_months} мес., "
                f"платёж {offer.monthly_payment:,} ₽/мес."
            )
        if result.get("required_documents"):
            parts.append("Нужные документы: " + "; ".join(result["required_documents"]))
        reasons = [f"{f.factor}: {f.description}" for f in factors if f.impact == "negative"]
        if reasons:
            parts.append("Причины: " + "; ".join(reasons))

        parts.append(
            "Объясни предпринимателю это решение так, чтобы было понятно, "
            "почему банк так поступил и что делать дальше."
        )
        return "\n".join(parts)

    @staticmethod
    def _clean(text: str) -> str:
        text = re.sub(r"^[#*\-\s]+", "", text.strip())
        text = text.replace("**", "").replace("###", "")
        return " ".join(text.split())

    # ------------------------------------------------------------------ #
    def _template(self, req: EvaluateRequest, result: dict) -> str:
        """Детерминированное объяснение — работает без LLM."""
        decision: Decision = result["decision"]
        offer: Offer | None = result.get("offer")
        intro = _DECISION_INTRO.get(decision, "Банк принял решение по заявке")

        if decision is Decision.APPROVED and offer is not None:
            return self._normalize(
                f"{intro}: {offer.amount:,} ₽ на {offer.term_months} мес. "
                f"Ежемесячный платёж составит {offer.monthly_payment:,} ₽ — "
                f"это комфортная нагрузка для вашего бизнеса."
            )

        if decision is Decision.COUNTER_OFFER and offer is not None:
            return self._normalize(
                f"{intro}. Так как нагрузка на бюджет {result['dsti']:.0%} выше безопасной, "
                f"банк предлагает {offer.amount:,} ₽ на {offer.term_months} мес. "
                f"с платежом {offer.monthly_payment:,} ₽ в месяц — так вы сохраните "
                f"больше свободных средств и снизите риски."
            )

        if decision is Decision.DOCS_REQUIRED:
            docs = ", ".join(result.get("required_documents", []))
            return self._normalize(
                f"{intro}. Для молодого бизнеса банк хочет подтвердить обороты, "
                f"поэтому просит: {docs}. После загрузки мы вернёмся к решению."
            )

        if decision is Decision.MANUAL_REVIEW:
            return self._normalize(
                f"{intro}. Ваша заявка в пограничной зоне по показателям, "
                f"поэтому сотрудник банка изучит её вручную и свяжется с вами "
                f"в течение рабочего дня."
            )

        reason = result.get("rejection_reason") or "показатели не соответствуют условиям банка"
        return self._normalize(
            f"{intro}. Причина: {reason}. "
            f"Вы можете обратиться снова, когда ситуация изменится, "
            f"или запросить меньшую сумму."
        )

    @staticmethod
    def _normalize(text: str) -> str:
        """Тысячные разделители через пробел + схлопывание двойных пробелов."""
        return re.sub(r"\s+", " ", text.replace(",", " ")).strip()
