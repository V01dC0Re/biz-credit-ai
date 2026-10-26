"""Тесты HTTP-контракта FastAPI через TestClient (без внешней сети).

Проверяем точный входной/выходной контракт, который дёргает Go-бэкенд, и
что плоские поля совместимы с scoring.Validate на стороне Go.
"""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from scoring_service.app import app, explainer

client = TestClient(app)
LLM_TEXT = "Банк предлагает скорректированные условия. Платёж соответствует доходам бизнеса."


@pytest.fixture(autouse=True)
def llm_transport(monkeypatch):
    """Проверяем HTTP-запрос к LLM без подключения к общему WireGuard."""
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": LLM_TEXT}}]})

    with httpx.Client(transport=httpx.MockTransport(respond)) as llm_client:
        monkeypatch.setattr(explainer, "_client", llm_client)
        yield requests


def payload(**overrides) -> dict:
    base = {
        "company_inn": "7701000002",
        "monthly_revenue": 2_000_000,
        "monthly_net_profit": 600_000,
        "company_age_months": 24,
        "requested_amount": 5_000_000,
        "requested_term_months": 24,
        "product_rate": 16.5,
        "bki_active_loans_monthly_payment": 0,
        "bki_delinquency_days": 0,
        "has_bankruptcy": False,
    }
    base.update(overrides)
    return base


def test_healthz():
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_evaluate_requests_llm_and_returns_its_explanation(llm_transport):
    resp = client.post("/api/v1/scoring/evaluate", json=payload())
    assert resp.status_code == 200
    assert resp.json()["ai_explanation"] == LLM_TEXT
    assert len(llm_transport) == 1
    request = llm_transport[0]
    assert request.method == "POST"
    assert str(request.url) == f"{explainer.s.ai_base_url.rstrip('/')}/chat/completions"
    body = json.loads(request.content)
    assert body["model"] == explainer.s.ai_model
    assert body["messages"][0]["role"] == "system"
    assert "COUNTER_OFFER" in body["messages"][1]["content"]


def test_evaluate_returns_full_contract():
    resp = client.post("/api/v1/scoring/evaluate", json=payload())
    assert resp.status_code == 200
    body = resp.json()
    # Поля выходного контракта из задания.
    for field in ("decision", "score_value", "dsti", "offer", "required_documents",
                  "key_factors", "ai_explanation"):
        assert field in body
    # Плоские поля для Go-совместимости.
    for field in ("approved_amount", "approved_term_months", "monthly_payment",
                  "interest_rate", "rejection_reason"):
        assert field in body
    assert body["ai_explanation"].strip()
    assert 0 <= body["score_value"] <= 1000


def test_counter_offer_has_consistent_offer():
    resp = client.post("/api/v1/scoring/evaluate", json=payload())
    body = resp.json()
    assert body["decision"] == "COUNTER_OFFER"
    offer = body["offer"]
    assert offer is not None
    assert offer["amount"] > 0
    assert offer["monthly_payment"] > 0
    # Плоские поля дублируют offer.
    assert body["approved_amount"] == offer["amount"]
    assert body["approved_term_months"] == offer["term_months"]


def test_approved_offer_equals_request():
    resp = client.post(
        "/api/v1/scoring/evaluate",
        json=payload(monthly_net_profit=2_000_000, requested_amount=3_000_000),
    )
    body = resp.json()
    assert body["decision"] == "APPROVED"
    assert body["offer"]["amount"] == 3_000_000
    assert body["offer"]["term_months"] == 24


def test_rejected_has_no_offer_and_reason():
    resp = client.post("/api/v1/scoring/evaluate", json=payload(has_bankruptcy=True))
    body = resp.json()
    assert body["decision"] == "REJECTED"
    assert body["offer"] is None
    assert body["rejection_reason"].strip()
    assert body["approved_amount"] == 0


def test_docs_required_lists_documents():
    resp = client.post(
        "/api/v1/scoring/evaluate",
        json=payload(company_age_months=3, bki_active_loans_monthly_payment=0),
    )
    body = resp.json()
    assert body["decision"] == "DOCS_REQUIRED"
    assert len(body["required_documents"]) >= 1


def test_invalid_payload_rejected_by_validation():
    resp = client.post("/api/v1/scoring/evaluate", json=payload(requested_amount=-5))
    assert resp.status_code == 422
