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

// Пороговые значения кредитной политики.
//
// ВАЖНО: эти константы обязаны совпадать со значениями по умолчанию в
// scoring_service/config.py (Settings). Go-fallback — это точное зеркало
// Python-движка, чтобы решение по заявке не зависело от того, доступен ли
// ML-сервис. При изменении политики правьте оба места синхронно.
const (
	dstiApproveMax      = 0.35  // DSTI <= 0.35 -> одобрение
	dstiCounterMax      = 0.55  // DSTI > 0.55 -> отказ
	safePaymentRatio    = 0.35  // доля прибыли под новый платёж
	delinquencyStopDays = 90    // просрочка > 90 дней -> стоп-фактор
	youngBusinessMonths = 6     // возраст < 6 мес. -> дозапрос документов
	scoreManualLow      = 450   // нижняя граница пограничного скора
	scoreManualHigh     = 550   // верхняя граница пограничного скора
	minOfferAmount      = 10000 // минимальная сумма встречного предложения
	maxTermMonths       = 60    // максимальный срок кредита
	amountRoundStep     = 50000 // шаг округления суммы вниз
)

// scoreOf повторяет балльную модель scoring_service/engine.py::_score.
func scoreOf(in Request, dsti float64) float64 {
	score := 500.0

	switch {
	case dsti <= dstiApproveMax:
		score += 250
	case dsti <= dstiCounterMax:
		score += 50
	default:
		score -= 250
	}

	switch {
	case in.CompanyAgeMonths >= 24:
		score += 150
	case in.CompanyAgeMonths >= 12:
		score += 100
	case in.CompanyAgeMonths < youngBusinessMonths:
		score -= 100
	}

	switch {
	case in.BKIDelinquencyDays == 0:
		score += 100
	case in.BKIDelinquencyDays <= 30:
		score -= 50
	default:
		score -= 200
	}

	if in.MonthlyRevenue > 0 {
		margin := float64(in.MonthlyNetProfit) / float64(in.MonthlyRevenue)
		if margin >= 0.2 {
			score += 50
		} else if margin < 0.05 {
			score -= 50
		}
	}

	if in.BKIMonthlyPayment > 0 {
		score -= 50
	}

	if score < 0 {
		score = 0
	}
	if score > 1000 {
		score = 1000
	}
	return score
}

// solveMaxAmount — максимальная сумма кредита при заданном предельном платеже.
func solveMaxAmount(maxPayment float64, term int, rate float64) float64 {
	if maxPayment <= 0 || term <= 0 {
		return 0
	}
	r := rate / 1200
	if r == 0 {
		return maxPayment * float64(term)
	}
	return maxPayment * (1 - math.Pow(1+r, -float64(term))) / r
}

func roundDown(value float64, step int64) int64 {
	if step <= 0 {
		return int64(value)
	}
	return int64(math.Floor(value/float64(step))) * step
}

// buildCounterOffer повторяет scoring_service/engine.py::_build_counter_offer:
// сначала удлиняем срок, сохраняя сумму; если не помогает — снижаем сумму.
func buildCounterOffer(in Request, pmtMax float64) (amount int64, term int, payment int64, ok bool) {
	if pmtMax <= 0 {
		return 0, 0, 0, false
	}
	for t := in.RequestedTermMonths; t <= maxTermMonths; t++ {
		p := Payment(in.RequestedAmount, t, in.ProductRate)
		if float64(p) <= pmtMax {
			return in.RequestedAmount, t, p, true
		}
	}
	a := roundDown(solveMaxAmount(pmtMax, in.RequestedTermMonths, in.ProductRate), amountRoundStep)
	if a > in.RequestedAmount {
		a = in.RequestedAmount
	}
	if a < minOfferAmount {
		return 0, 0, 0, false
	}
	return a, in.RequestedTermMonths, Payment(a, in.RequestedTermMonths, in.ProductRate), true
}

func rejectResult(base Result, reason string) Result {
	base.Decision = models.StatusRejected
	base.ApprovedAmount = 0
	base.ApprovedTermMonths = 0
	base.MonthlyPayment = 0
	base.RejectionReason = reason
	base.AIExplanation = reason
	if base.ScoreValue > 300 {
		base.ScoreValue = 300
	}
	return base
}

// Fallback — детерминированная копия политики Python-движка скоринга.
// Используется, когда ML-сервис недоступен, и обязан давать тот же результат.
func Fallback(in Request, documentsUploaded bool) Result {
	payment := Payment(in.RequestedAmount, in.RequestedTermMonths, in.ProductRate)
	dsti := 1.0
	if in.MonthlyNetProfit > 0 {
		dsti = float64(payment+in.BKIMonthlyPayment) / float64(in.MonthlyNetProfit)
	}
	score := scoreOf(in, dsti)

	base := Result{
		Decision:     models.StatusApproved,
		ScoreValue:   score,
		DSTI:         dsti,
		InterestRate: in.ProductRate,
	}

	// 1. Стоп-факторы перебивают всё.
	if in.HasBankruptcy {
		return rejectResult(base, "По данным ФНС у компании есть признаки банкротства")
	}
	if in.BKIDelinquencyDays > delinquencyStopDays {
		return rejectResult(base, fmt.Sprintf(
			"Просрочка %d дней превышает порог %d дней", in.BKIDelinquencyDays, delinquencyStopDays))
	}
	if in.MonthlyNetProfit <= 0 {
		return rejectResult(base, "Отсутствует положительная чистая прибыль для обслуживания кредита")
	}

	// 2. Молодой бизнес без кредитной истории -> дозапрос документов.
	if !documentsUploaded && in.CompanyAgeMonths < youngBusinessMonths &&
		in.BKIMonthlyPayment == 0 && in.BKIDelinquencyDays == 0 {
		base.Decision = models.StatusDocsRequired
		base.AIExplanation = "Для молодого бизнеса требуется выписка, подтверждающая обороты."
		return base
	}

	// 3. Документы уже загружены -> ручная верификация андеррайтером.
	if documentsUploaded {
		base.Decision = models.StatusManualReview
		base.AIExplanation = "Документы получены: требуется ручная верификация андеррайтером."
		return base
	}

	// 4. DSTI в пределах нормы -> одобрение (либо ручной разбор при пограничном скоре).
	if dsti <= dstiApproveMax {
		if score >= scoreManualLow && score <= scoreManualHigh {
			base.Decision = models.StatusManualReview
			base.AIExplanation = "Пограничный скоринг-балл: нужна ручная оценка."
			return base
		}
		base.Decision = models.StatusApproved
		base.ApprovedAmount = in.RequestedAmount
		base.ApprovedTermMonths = in.RequestedTermMonths
		base.MonthlyPayment = payment
		base.AIExplanation = "Демонстрационная оценка: прибыль позволяет обслуживать кредит."
		return base
	}

	// 5. Пограничный скор при наличии просрочек -> ручной разбор.
	if score >= scoreManualLow && score <= scoreManualHigh && in.BKIDelinquencyDays > 0 {
		base.Decision = models.StatusManualReview
		base.AIExplanation = "Пограничный скоринг-балл при наличии просрочек: нужна ручная оценка."
		return base
	}

	// 6. Встречное предложение с безопасными условиями.
	pmtMax := float64(in.MonthlyNetProfit)*safePaymentRatio - float64(in.BKIMonthlyPayment)
	amount, term, newPayment, ok := buildCounterOffer(in, pmtMax)
	if !ok {
		reason := "Недостаточно свободной прибыли для безопасного платежа"
		if dsti > dstiCounterMax {
			reason = fmt.Sprintf("Долговая нагрузка %.0f%% превышает допустимый предел банка", dsti*100)
		}
		return rejectResult(base, reason)
	}
	base.Decision = models.StatusCounterOffer
	base.ApprovedAmount = amount
	base.ApprovedTermMonths = term
	base.MonthlyPayment = newPayment
	// DSTI остаётся исходным (по запрошенной сумме) — как в Python-движке.
	if dsti > dstiCounterMax {
		base.ScoreValue = math.Min(1000, score+300)
	}
	base.AIExplanation = "Предлагаем безопасные условия, чтобы платежи не превышали 35% чистой прибыли."
	return base
}
