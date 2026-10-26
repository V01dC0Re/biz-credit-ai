package handlers

import (
	"net/http"
	"strings"

	"biz-credit-ai/internal/mocks"
	"github.com/gin-gonic/gin"
)

// MockFNS — GET /internal/mocks/fns/:inn
// Симулятор сервиса ФНС «Прозрачный бизнес» / ЕГРЮЛ (UC 3.1).
func (h *Handler) MockFNS(c *gin.Context) {
	inn := strings.TrimSpace(c.Param("inn"))
	if inn == "" {
		fail(c, http.StatusBadRequest, "Не указан ИНН")
		return
	}
	c.JSON(http.StatusOK, mocks.FNS(inn))
}

// MockBKI — GET /internal/mocks/bki/:inn
// Симулятор бюро кредитных историй (UC 3.1).
func (h *Handler) MockBKI(c *gin.Context) {
	inn := strings.TrimSpace(c.Param("inn"))
	if inn == "" {
		fail(c, http.StatusBadRequest, "Не указан ИНН")
		return
	}
	c.JSON(http.StatusOK, mocks.BKI(inn))
}
