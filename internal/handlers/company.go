package handlers

import (
	"net/http"
	"strings"

	"biz-credit-ai/internal/mocks"
	"github.com/gin-gonic/gin"
)

// CompanyLookup — GET /api/company/lookup?inn=7701000001
//
// UC 1.3: автозаполнение реквизитов по ИНН. Обращается к локальному моку
// ФНС/ЕГРЮЛ и возвращает данные для предзаполнения формы заявки.
func (h *Handler) CompanyLookup(c *gin.Context) {
	inn := strings.TrimSpace(c.Query("inn"))
	if len(inn) < 10 || len(inn) > 12 {
		fail(c, http.StatusBadRequest, "ИНН должен содержать 10 или 12 цифр")
		return
	}
	for _, r := range inn {
		if r < '0' || r > '9' {
			fail(c, http.StatusBadRequest, "ИНН должен содержать только цифры")
			return
		}
	}
	rec := mocks.FNS(inn)
	c.JSON(http.StatusOK, gin.H{
		"inn":                rec.INN,
		"name":               rec.Name,
		"okved":              rec.OKVED,
		"registration_date":  rec.RegistrationDate,
		"company_age_months": rec.AgeMonths,
		"status":             rec.Status,
		"source":             rec.Source,
	})
}
