package scoring

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"biz-credit-ai/internal/models"
)

func sample() Request {
	return Request{CompanyINN: "7701000001", MonthlyRevenue: 2000000, MonthlyNetProfit: 600000, CompanyAgeMonths: 100, RequestedAmount: 1500000, RequestedTermMonths: 12, ProductRate: 20, BKIMonthlyPayment: 50000}
}
func TestFallbackDecisions(t *testing.T) {
	tests := []struct {
		name   string
		change func(*Request)
		docs   bool
		want   models.ApplicationStatus
	}{
		{"approved", func(r *Request) {}, false, models.StatusApproved},
		{"counter", func(r *Request) { r.RequestedAmount = 10000000 }, false, models.StatusCounterOffer},
		{"bankruptcy", func(r *Request) { r.HasBankruptcy = true }, false, models.StatusRejected},
		// Просрочка-стоп-фактор срабатывает только выше 90 дней (политика Python).
		{"delinquency_stop", func(r *Request) { r.BKIDelinquencyDays = 120 }, false, models.StatusRejected},
		{"zero_profit", func(r *Request) { r.MonthlyNetProfit = 0 }, false, models.StatusRejected},
		{"no_capacity", func(r *Request) { r.MonthlyNetProfit = 1000 }, false, models.StatusRejected},
		// Молодой бизнес без кредитной истории (нет платежей в БКИ) -> дозапрос.
		{"young", func(r *Request) { r.CompanyAgeMonths = 1; r.BKIMonthlyPayment = 0 }, false, models.StatusDocsRequired},
		{"uploaded", func(r *Request) { r.CompanyAgeMonths = 1; r.BKIMonthlyPayment = 0 }, true, models.StatusManualReview},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := sample()
			tt.change(&in)
			got := Fallback(in, tt.docs)
			if got.Decision != tt.want {
				t.Fatalf("got %s", got.Decision)
			}
			if err := Validate(got, in); err != nil {
				t.Fatal(err)
			}
			if got.Decision == models.StatusCounterOffer && got.ApprovedAmount >= in.RequestedAmount {
				t.Fatalf("invalid counter: %+v", got)
			}
		})
	}
}
func TestMLContractAndFallback(t *testing.T) {
	for _, mode := range []string{"ok", "http_error", "malformed", "invalid_decision", "invalid_terms"} {
		t.Run(mode, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != "/api/v1/scoring/evaluate" {
					t.Errorf("wrong endpoint")
				}
				var in Request
				if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.CompanyINN != "7701000001" {
					t.Errorf("wrong request")
				}
				result := Fallback(in, false)
				switch mode {
				case "http_error":
					w.WriteHeader(503)
					return
				case "malformed":
					w.Write([]byte("{"))
					return
				case "invalid_decision":
					result.Decision = models.StatusIssued
				case "invalid_terms":
					result.ApprovedAmount = -1
				}
				json.NewEncoder(w).Encode(result)
			}))
			defer srv.Close()
			got, source := New(srv.URL).Evaluate(context.Background(), sample(), false)
			wantSource := "fallback"
			if mode == "ok" {
				wantSource = "ml"
			}
			if source != wantSource || got.Decision != models.StatusApproved {
				t.Fatalf("source=%s result=%+v", source, got)
			}
		})
	}
}
func TestPayment(t *testing.T) {
	if Payment(120000, 12, 0) != 10000 || Payment(1500000, 12, 20) != 138952 {
		t.Fatal("incorrect annuity")
	}
}
