package scoring

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"biz-credit-ai/internal/models"
)

// parityCase — один кейс из общего фикстура tests/scoring_cases.json.
type parityCase struct {
	Name             string  `json:"name"`
	Input            Request `json:"input"`
	ExpectedDecision string  `json:"expected_decision"`
	ExpectedDSTI     float64 `json:"expected_dsti"`
}

// TestFallbackParityWithPython гарантирует, что Go-fallback даёт ровно те же
// решения, что и Python-движок (scoring_service/engine.py) на общем наборе
// кейсов. Фикстур читают оба теста, поэтому расхождение политик невозможно
// протащить незаметно.
func TestFallbackParityWithPython(t *testing.T) {
	path := filepath.Join("..", "..", "tests", "scoring_cases.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("не удалось прочитать фикстур %s: %v", path, err)
	}
	var fixture struct {
		Cases []parityCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("некорректный фикстур: %v", err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("фикстур пуст")
	}

	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			got := Fallback(c.Input, c.Input.DocumentsUploaded)
			if string(got.Decision) != c.ExpectedDecision {
				t.Fatalf("decision=%s, ожидалось %s (dsti=%.3f score=%.0f)",
					got.Decision, c.ExpectedDecision, got.DSTI, got.ScoreValue)
			}
			// DSTI обязан совпадать с Python-эталоном (допуск на округление).
			if diff := got.DSTI - c.ExpectedDSTI; diff > 0.001 || diff < -0.001 {
				t.Fatalf("dsti=%.4f, ожидалось %.4f", got.DSTI, c.ExpectedDSTI)
			}
			// Ответ обязан проходить контрактную валидацию ML-клиента.
			if err := Validate(got, c.Input); err != nil {
				t.Fatalf("результат не проходит Validate: %v", err)
			}
		})
	}
}

// TestFallbackCounterOfferIsSafe проверяет, что встречное предложение реально
// снижает нагрузку до безопасного уровня.
func TestFallbackCounterOfferIsSafe(t *testing.T) {
	in := Request{
		MonthlyRevenue: 2000000, MonthlyNetProfit: 600000, CompanyAgeMonths: 100,
		RequestedAmount: 10000000, RequestedTermMonths: 12, ProductRate: 20,
		BKIMonthlyPayment: 50000,
	}
	got := Fallback(in, false)
	if got.Decision != models.StatusCounterOffer {
		t.Fatalf("ожидалось COUNTER_OFFER, получено %s", got.Decision)
	}
	pmtMax := float64(in.MonthlyNetProfit)*safePaymentRatio - float64(in.BKIMonthlyPayment)
	if float64(got.MonthlyPayment) > pmtMax+1 {
		t.Fatalf("платёж %d превышает безопасный предел %.0f", got.MonthlyPayment, pmtMax)
	}
	if got.ApprovedAmount >= in.RequestedAmount {
		t.Fatalf("сумма встречного %d не меньше запрошенной %d", got.ApprovedAmount, in.RequestedAmount)
	}
}
