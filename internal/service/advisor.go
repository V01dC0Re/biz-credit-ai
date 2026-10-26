package service

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"biz-credit-ai/internal/ai"
	"biz-credit-ai/internal/config"
	"biz-credit-ai/internal/domain"
)

// AdvisorService handles AI-based financial advice with deterministic fallbacks
type AdvisorService struct {
	client *ai.OpenAICompatibleClient
	cfg    *config.Config
}

// NewAdvisorService creates a new advisor service
func NewAdvisorService(cfg *config.Config) *AdvisorService {
	return &AdvisorService{
		client: ai.NewOpenAICompatibleClient(&cfg.AI),
		cfg:    cfg,
	}
}

// CompareProducts explains differences between credit products
func (s *AdvisorService) CompareProducts(ctx context.Context, productA, productB string) (string, error) {
	llmCtx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()

	messages := ai.PromptCompareProducts(productA, productB)
	resp, err := s.client.Chat(llmCtx, messages, 0.7, 1000)
	if err == nil && len(strings.TrimSpace(resp)) > 50 {
		return resp, nil
	}

	// Детерминированный fallback (по аналогии с Python scoring_service/llm.py)
	return fallbackCompareProducts(productA, productB), nil
}

// GetContextualAdvice gives advice based on client parameters
func (s *AdvisorService) GetContextualAdvice(ctx context.Context, request domain.CreditAdviceRequest) (string, error) {
	llmCtx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()

	messages := ai.PromptContextualHint(request)
	resp, err := s.client.Chat(llmCtx, messages, 0.7, 1000)
	if err == nil && len(strings.TrimSpace(resp)) > 30 {
		return resp, nil
	}

	// Детерминированный fallback с расчетом безопасного платежа
	return fallbackContextualAdvice(request), nil
}

// ExplainBankDecision explains bank's counter-offer or rejection
func (s *AdvisorService) ExplainBankDecision(ctx context.Context, decision domain.BankDecisionExplanation) (string, error) {
	llmCtx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()

	messages := ai.PromptExplainBankDecision(decision)
	resp, err := s.client.Chat(llmCtx, messages, 0.7, 1000)
	if err == nil && len(strings.TrimSpace(resp)) > 30 {
		return resp, nil
	}

	// Детерминированный fallback объяснения решения
	return fallbackExplainBankDecision(decision), nil
}

// OfficerSummary генерирует краткую выжимку по заявке для риск-офицера (UC 2.2).
func (s *AdvisorService) OfficerSummary(ctx context.Context, data domain.OfficerSummaryRequest) (string, error) {
	llmCtx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
	defer cancel()

	messages := ai.PromptOfficerSummary(data)
	resp, err := s.client.Chat(llmCtx, messages, 0.4, 300)
	if err == nil && len(strings.TrimSpace(resp)) > 30 {
		return resp, nil
	}

	// Детерминированный fallback: собираем выжимку из показателей.
	return fallbackOfficerSummary(data), nil
}

// fallbackOfficerSummary формирует выжимку без LLM по формализованным правилам.
func fallbackOfficerSummary(d domain.OfficerSummaryRequest) string {
	risk := "низкий"
	recommendation := "одобрить заявку"
	switch {
	case d.HasBankruptcy || d.DelinquencyDays > 90 || d.MonthlyNetProfit <= 0:
		risk = "высокий"
		recommendation = "отказать"
	case d.DSTI > 0.55:
		risk = "высокий"
		recommendation = "отказать или существенно снизить сумму"
	case d.DSTI > 0.35 || d.DelinquencyDays > 0:
		risk = "средний"
		recommendation = "одобрить с уменьшением суммы"
	}

	factors := make([]string, 0, 2)
	if d.MonthlyRevenue > 0 {
		factors = append(factors, fmt.Sprintf("выручка %.0f руб/мес", d.MonthlyRevenue))
	}
	if d.DelinquencyDays > 0 {
		factors = append(factors, fmt.Sprintf("просрочка %d дн.", d.DelinquencyDays))
	} else {
		factors = append(factors, "просрочек нет")
	}
	if d.DSTI > 0 {
		factors = append(factors, fmt.Sprintf("DSTI %.0f%%", d.DSTI*100))
	}

	return fmt.Sprintf("Риск %s. %s. Рекомендую %s.",
		risk, strings.Join(factors, ", "), recommendation)
}

func fallbackCompareProducts(productA, productB string) string {
	nameA := strings.TrimSpace(productA)
	if nameA == "" {
		nameA = "Овердрафт для бизнеса"
	}
	nameB := strings.TrimSpace(productB)
	if nameB == "" {
		nameB = "Оборотный кредит"
	}

	return fmt.Sprintf(`### Сравнительный анализ финансовых инструментов

**%s** и **%s** решают разные задачи управления ликвидностью компании:

1. **Суть и назначение инструментов:**
   - **Овердрафт** — это оперативная «подушка безопасности», привязанная к расчетному счету. Позволяет совершать платежи контрагентам, выплачивать зарплату и налоги при временном отсутствии средств на счете. Идеален для мгновенного закрытия кассовых разрывов сроком до 30–60 дней.
   - **Оборотный кредит** — целевое финансирование оборотных активов на фиксированный срок (от 3 до 36 месяцев). Средства выдаются разовым траншем или в рамках кредитной линии на плановые закупки сырья, расширение ассортимента или исполнение контрактов.

2. **Ставки и льготный период:**
   - По овердрафту проценты начисляются посуточно исключительно на фактически использованный остаток лимита. Доступен траншевый период погашения (до 30 дней), при котором проценты минимальны, а погашение происходит автоматически из любых поступающих входящих платежей.
   - По оборотному кредиту действует фиксированная процентная ставка на весь срок кредитования с прозрачным ежемесячным графиком аннуитетных платежей.

3. **Сравнение параметров:**
| Параметр | Овердрафт | Оборотный кредит |
|---|---|---|
| **Лимит финансирования** | До 5 000 000 ₽ (до 50%% среднемесячного оборота) | До 10 000 000 ₽ (на основании годовой выручки) |
| **Срок транша / кредита** | Транш до 30–60 дней, договор на 12 мес. | От 3 до 36 месяцев |
| **Механизм погашения** | Автоматическое списание при поступлении выручки | Ежемесячный платеж по графику |
| **Залог и обеспечение** | Без залога под оборот по счету | Без залога (до 10 млн ₽) или поручительство |

4. **Рекомендация эксперта:**
   - Если вам требуется непрерывная страховка от задержек оплат от покупателей на 2–4 недели — выбирайте **Овердрафт**.
   - Если планируется масштабная закупка товара или участие в тендере с длинным циклом оборачиваемости (от 3 месяцев) — оптимален **Оборотный кредит**.`, nameA, nameB)
}

func fallbackContextualAdvice(req domain.CreditAdviceRequest) string {
	safeRatio := 0.35
	safePayment := req.NetProfit * safeRatio
	term := req.RequestedTerm
	if term <= 0 {
		term = 12
	}

	monthlyRate := 0.18 / 12.0
	factor := math.Pow(1.0+monthlyRate, float64(term))
	estPayment := 0.0
	if factor > 1.0 {
		estPayment = req.RequestedAmount * (monthlyRate * factor) / (factor - 1.0)
	} else {
		estPayment = req.RequestedAmount / float64(term)
	}

	dsti := 0.0
	if req.NetProfit > 0 {
		dsti = (estPayment / req.NetProfit) * 100.0
	}

	if dsti <= 35.0 {
		return fmt.Sprintf("Финансовый анализ запроса: при чистой прибыли %.0f ₽/мес и запрошенной сумме %.0f ₽ (на %d мес.) расчетный ежемесячный платеж составит около %.0f ₽/мес (DSTI: %.1f%%). Это находится в безопасной «зеленой» зоне (норматив банка ≤ 35%%). Долговая нагрузка комфортна для операционного денежного потока вашего бизнеса.", req.NetProfit, req.RequestedAmount, term, estPayment, dsti)
	}

	maxSafeAmount := 0.0
	if monthlyRate > 0 && factor > 1.0 {
		maxSafeAmount = (safePayment * (factor - 1.0)) / (monthlyRate * factor)
	}
	return fmt.Sprintf("Финансовая рекомендация: при текущей прибыли %.0f ₽/мес расчетный платеж по сумме %.0f ₽ составит около %.0f ₽/мес (DSTI: %.1f%%), что превышает рекомендуемый лимит безопасности (35%% чистой прибыли). Рекомендуемый максимальный безопасный платеж — не более %.0f ₽/мес (максимальная рекомендуемая сумма под текущий срок: около %.0f ₽, либо увеличение срока кредитования).", req.NetProfit, req.RequestedAmount, estPayment, dsti, safePayment, maxSafeAmount)
}

func fallbackExplainBankDecision(decision domain.BankDecisionExplanation) string {
	decType := strings.ToLower(decision.DecisionType)
	switch {
	case strings.Contains(decType, "counter"):
		return fmt.Sprintf("Банк готов предоставить финансирование на скорректированных условиях: сумма %.0f ₽ на срок %d мес. (вместо исходных %.0f ₽ на %d мес.). Корректировка параметров выполнена для соблюдения норматива предельной долговой нагрузки (DSTI ≤ 35%%) и сохранения стабильности операционных расчетов компании.", decision.CounterAmount, decision.CounterTerm, decision.OriginalAmount, decision.OriginalTerm)
	case strings.Contains(decType, "reject"):
		reasons := "наличие стоп-факторов или повышенная кредитная нагрузка"
		if len(decision.Reasons) > 0 {
			reasons = strings.Join(decision.Reasons, ", ")
		}
		return fmt.Sprintf("К сожалению, в настоящее время банк не может одобрить заявку на сумму %.0f ₽. Основные факторы отказа: %s. Рекомендуем снизить текущую долговую нагрузку или предоставить дополнительное обеспечение/поручительство для повторного рассмотрения через 30 дней.", decision.OriginalAmount, reasons)
	default:
		return fmt.Sprintf("Заявка на сумму %.0f ₽ на срок %d мес. успешно одобрена. Параметры кредита полностью соответствуют финансовому профилю компании и нормативу платежеспособности банка.", decision.OriginalAmount, decision.OriginalTerm)
	}
}
