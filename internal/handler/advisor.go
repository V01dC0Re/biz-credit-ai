package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"biz-credit-ai/internal/config"
	"biz-credit-ai/internal/domain"
	"biz-credit-ai/internal/service"
)

// AdvisorHandler handles HTTP requests for financial advice
type AdvisorHandler struct {
	service *service.AdvisorService
	cfg     *config.Config
}

// NewAdvisorHandler creates a new advisor handler
func NewAdvisorHandler(svc *service.AdvisorService, cfg *config.Config) *AdvisorHandler {
	return &AdvisorHandler{
		service: svc,
		cfg:     cfg,
	}
}

// CompareProducts handles POST /api/advice/compare
func (h *AdvisorHandler) CompareProducts(c *gin.Context) {
	var req struct {
		ProductA string `json:"product_a" binding:"required"`
		ProductB string `json:"product_b" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	advice, err := h.service.CompareProducts(c.Request.Context(), req.ProductA, req.ProductB)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"type":      "comparison",
		"product_a": req.ProductA,
		"product_b": req.ProductB,
		"advice":    advice,
	})
}

// GetContextualAdvice handles POST /api/advice/contextual
func (h *AdvisorHandler) GetContextualAdvice(c *gin.Context) {
	var req domain.CreditAdviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	advice, err := h.service.GetContextualAdvice(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"type":   "contextual_advice",
		"client": req.ClientID,
		"advice": advice,
	})
}

// ExplainBankDecision handles POST /api/advice/explain-decision
func (h *AdvisorHandler) ExplainBankDecision(c *gin.Context) {
	var req domain.BankDecisionExplanation
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	explanation, err := h.service.ExplainBankDecision(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"type":        "decision_explanation",
		"decision":    req.DecisionType,
		"explanation": explanation,
	})
}

// OfficerSummary handles POST /api/v1/advice/officer-summary (UC 2.2).
// Генерирует краткую выжимку по заявке для риск-офицера.
func (h *AdvisorHandler) OfficerSummary(c *gin.Context) {
	var req domain.OfficerSummaryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	summary, err := h.service.OfficerSummary(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"type":    "officer_summary",
		"summary": summary,
	})
}
