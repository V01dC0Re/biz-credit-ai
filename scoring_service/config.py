"""Конфигурация микросервиса скоринга (переменные окружения)."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env_float(key: str, default: float) -> float:
    try:
        return float(os.getenv(key, default))
    except (TypeError, ValueError):
        return default


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.getenv(key, default))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Settings:
    """Пороговые значения политики банка (настраиваются без изменения кода)."""

    # Границы DSTI (доля чистой прибыли, уходящая на обслуживание долга).
    dsti_approve_max: float = 0.35
    dsti_counter_max: float = 0.55

    # Доля прибыли, которую банк считает безопасной для нового платежа.
    safe_payment_ratio: float = 0.35

    # Стоп-факторы БКИ.
    delinquency_stop_days: int = 90

    # Молодой бизнес -> дозапрос документов, если нет истории.
    young_business_months: int = 6

    # Границы скор-балла.
    score_min: int = 0
    score_max: int = 1000
    score_manual_review_low: int = 450
    score_manual_review_high: int = 550

    # Границы встречного предложения.
    min_offer_amount: int = 10_000
    min_term_months: int = 1
    max_term_months: int = 60
    amount_round_step: int = 50_000
    term_step_months: int = 1

    # LLM.
    ai_base_url: str = "http://10.154.0.1:8080/v1"
    ai_model: str = "gemma4:12b"
    ai_api_key: str = ""
    ai_timeout_seconds: float = 30.0

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            dsti_approve_max=_env_float("DSTI_APPROVE_MAX", cls.dsti_approve_max),
            dsti_counter_max=_env_float("DSTI_COUNTER_MAX", cls.dsti_counter_max),
            safe_payment_ratio=_env_float("SAFE_PAYMENT_RATIO", cls.safe_payment_ratio),
            delinquency_stop_days=_env_int("DELINQUENCY_STOP_DAYS", cls.delinquency_stop_days),
            young_business_months=_env_int("YOUNG_BUSINESS_MONTHS", cls.young_business_months),
            score_manual_review_low=_env_int("SCORE_MANUAL_REVIEW_LOW", cls.score_manual_review_low),
            score_manual_review_high=_env_int("SCORE_MANUAL_REVIEW_HIGH", cls.score_manual_review_high),
            min_offer_amount=_env_int("MIN_OFFER_AMOUNT", cls.min_offer_amount),
            amount_round_step=_env_int("AMOUNT_ROUND_STEP", cls.amount_round_step),
            # Пустой AI_BASE_URL (например, когда WireGuard-прокси выключен)
            # трактуем как значение по умолчанию, а не как пустую строку.
            ai_base_url=os.getenv("AI_BASE_URL") or cls.ai_base_url,
            ai_model=os.getenv("AI_MODEL") or cls.ai_model,
            ai_api_key=os.getenv("AI_API_KEY", cls.ai_api_key),
            ai_timeout_seconds=_env_float("AI_TIMEOUT", cls.ai_timeout_seconds),
        )
