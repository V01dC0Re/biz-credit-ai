package scoring

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"biz-credit-ai/internal/models"
)

type Request struct {
	CompanyINN          string  `json:"company_inn"`
	MonthlyRevenue      int64   `json:"monthly_revenue"`
	MonthlyNetProfit    int64   `json:"monthly_net_profit"`
	CompanyAgeMonths    int     `json:"company_age_months"`
	RequestedAmount     int64   `json:"requested_amount"`
	RequestedTermMonths int     `json:"requested_term_months"`
	ProductRate         float64 `json:"product_rate"`
	BKIMonthlyPayment   int64   `json:"bki_active_loans_monthly_payment"`
	BKIDelinquencyDays  int     `json:"bki_delinquency_days"`
	HasBankruptcy       bool    `json:"has_bankruptcy"`
	DocumentsUploaded   bool    `json:"documents_uploaded"`
}
type Result struct {
	Decision           models.ApplicationStatus `json:"decision"`
	ApprovedAmount     int64                    `json:"approved_amount"`
	ApprovedTermMonths int                      `json:"approved_term_months"`
	MonthlyPayment     int64                    `json:"monthly_payment"`
	InterestRate       float64                  `json:"interest_rate"`
	ScoreValue         float64                  `json:"score_value"`
	DSTI               float64                  `json:"dsti"`
	RejectionReason    string                   `json:"rejection_reason"`
	AIExplanation      string                   `json:"ai_explanation"`
}
type Client struct {
	BaseURL string
	HTTP    *http.Client
}

func New(baseURL string) *Client {
	return &Client{BaseURL: strings.TrimRight(baseURL, "/"), HTTP: &http.Client{Timeout: 40 * time.Second}}
}
func Payment(amount int64, term int, rate float64) int64 {
	if term <= 0 || amount <= 0 {
		return 0
	}
	r := rate / 1200
	if r == 0 {
		return int64(math.Ceil(float64(amount) / float64(term)))
	}
	return int64(math.Ceil(float64(amount) * r / (1 - math.Pow(1+r, -float64(term)))))
}
func (c *Client) Evaluate(ctx context.Context, input Request, documentsUploaded bool) (Result, string) {
	input.DocumentsUploaded = documentsUploaded
	if c != nil && c.BaseURL != "" {
		result, err := c.remote(ctx, input)
		if err == nil {
			return result, "ml"
		}
		log.Printf("ML scoring unavailable, using demo rules: %v", err)
	}
	return Fallback(input, documentsUploaded), "fallback"
}
func (c *Client) remote(ctx context.Context, input Request) (Result, error) {
	var result Result
	body, _ := json.Marshal(input)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/v1/scoring/evaluate", bytes.NewReader(body))
	if err != nil {
		return result, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return result, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return result, fmt.Errorf("ML HTTP %d", resp.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 1<<20))
	if err := decoder.Decode(&result); err != nil {
		return result, err
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return result, fmt.Errorf("invalid ML response body")
	}
	if err := Validate(result, input); err != nil {
		return result, err
	}
	return result, nil
}
func Validate(r Result, in Request) error {
	switch r.Decision {
	case models.StatusApproved, models.StatusCounterOffer:
		if r.ApprovedAmount <= 0 || r.ApprovedAmount > in.RequestedAmount || r.ApprovedTermMonths < 1 || r.ApprovedTermMonths > 60 || r.MonthlyPayment <= 0 || r.InterestRate < 0 || r.InterestRate > 100 {
			return fmt.Errorf("invalid ML terms")
		}
	case models.StatusRejected:
		if strings.TrimSpace(r.RejectionReason) == "" {
			return fmt.Errorf("missing rejection reason")
		}
	case models.StatusDocsRequired, models.StatusManualReview:
	default:
		return fmt.Errorf("invalid ML decision")
	}
	if r.Decision != models.StatusApproved && r.Decision != models.StatusCounterOffer && (r.ApprovedAmount != 0 || r.ApprovedTermMonths != 0 || r.MonthlyPayment != 0) {
		return fmt.Errorf("unexpected ML approval terms")
	}
	if math.IsNaN(r.DSTI) || math.IsInf(r.DSTI, 0) || r.DSTI < 0 || r.ScoreValue < 0 || r.ScoreValue > 1000 || strings.TrimSpace(r.AIExplanation) == "" {
		return fmt.Errorf("invalid ML explanation or metrics")
	}
	return nil
}
func Fallback(in Request, documentsUploaded bool) Result {
	payment := Payment(in.RequestedAmount, in.RequestedTermMonths, in.ProductRate)
	r := Result{Decision: models.StatusApproved, ApprovedAmount: in.RequestedAmount, ApprovedTermMonths: in.RequestedTermMonths, MonthlyPayment: payment, InterestRate: in.ProductRate, ScoreValue: 800, AIExplanation: "Демонстрационная оценка: прибыль позволяет обслуживать кредит."}
	if in.MonthlyNetProfit > 0 {
		r.DSTI = float64(payment+in.BKIMonthlyPayment) / float64(in.MonthlyNetProfit)
	}
	switch {
	case in.HasBankruptcy || in.BKIDelinquencyDays > 30 || in.MonthlyNetProfit <= 0:
		r.Decision = models.StatusRejected
		r.ScoreValue = 200
		switch {
		case in.HasBankruptcy:
			r.RejectionReason = "У компании есть признаки банкротства."
		case in.BKIDelinquencyDays > 30:
			r.RejectionReason = "Просрочка по действующим кредитам превышает 30 дней."
		default:
			r.RejectionReason = "Отсутствует положительная чистая прибыль для обслуживания кредита."
		}
		r.AIExplanation = r.RejectionReason
	case in.CompanyAgeMonths < 6 && !documentsUploaded:
		r.Decision = models.StatusDocsRequired
		r.ScoreValue = 450
		r.AIExplanation = "Для молодого бизнеса требуется выписка, подтверждающая обороты."
	case in.BKIDelinquencyDays > 0 || in.CompanyAgeMonths < 6:
		r.Decision = models.StatusManualReview
		r.ScoreValue = 500
		r.AIExplanation = "Требуется проверка риск-офицером: небольшой возраст бизнеса или просрочки."
	case r.DSTI > 0.5:
		capacity := float64(in.MonthlyNetProfit)*0.5 - float64(in.BKIMonthlyPayment)
		amount := int64(math.Floor(float64(in.RequestedAmount) * capacity / float64(payment)))
		if amount < 10000 {
			r.Decision = models.StatusRejected
			r.ScoreValue = 250
			r.RejectionReason = "Недостаточно свободной прибыли для обслуживания кредита."
			r.AIExplanation = r.RejectionReason
		} else {
			r.Decision = models.StatusCounterOffer
			r.ScoreValue = 600
			r.ApprovedAmount = amount
			r.MonthlyPayment = Payment(amount, in.RequestedTermMonths, in.ProductRate)
			r.DSTI = float64(r.MonthlyPayment+in.BKIMonthlyPayment) / float64(in.MonthlyNetProfit)
			r.AIExplanation = "Предлагаем уменьшить сумму, чтобы платежи не превышали 50% чистой прибыли."
		}
	}
	if r.Decision != models.StatusApproved && r.Decision != models.StatusCounterOffer {
		r.ApprovedAmount = 0
		r.ApprovedTermMonths = 0
		r.MonthlyPayment = 0
	}
	return r
}
