"""Паритет политики скоринга: Python-движок против общего фикстура.

Фикстур tests/scoring_cases.json — единый источник истины. Тот же файл читает
Go-тест internal/scoring/parity_test.go. Если движки разойдутся, упадут оба.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scoring_service.config import Settings
from scoring_service.engine import ScoringEngine
from scoring_service.schemas import EvaluateRequest

CASES = json.loads((Path(__file__).parent / "scoring_cases.json").read_text(encoding="utf-8"))["cases"]
ENGINE = ScoringEngine(Settings())


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_python_engine_matches_fixture(case: dict) -> None:
    req = EvaluateRequest(**case["input"])
    result = ENGINE.evaluate(req)
    assert result["decision"].value == case["expected_decision"], (
        f"{case['name']}: got {result['decision'].value}, want {case['expected_decision']}"
    )
    assert abs(result["dsti"] - case["expected_dsti"]) < 0.001, (
        f"{case['name']}: dsti={result['dsti']}, want {case['expected_dsti']}"
    )
