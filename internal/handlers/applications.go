package handlers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"biz-credit-ai/internal/middleware"
	"biz-credit-ai/internal/mocks"
	"biz-credit-ai/internal/models"
	"biz-credit-ai/internal/scoring"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errTransition = errors.New("Недопустимый переход статуса заявки")

func logStatus(tx *gorm.DB, appID uint, from, to, comment string) {
	log := models.ApplicationStatusLog{
		ApplicationID: appID,
		FromStatus:    from,
		ToStatus:      to,
		Comment:       strings.TrimSpace(comment),
		CreatedAt:     time.Now(),
	}
	_ = tx.Create(&log).Error
}

func RequireRole(role models.Role) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := c.Get(middleware.UserContextKey)
		u, valid := user.(models.User)
		if !ok || !valid || u.Role != role {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Недостаточно прав"})
			return
		}
		c.Next()
	}
}
func (h *Handler) Products(c *gin.Context) { c.JSON(200, gin.H{"products": models.Products()}) }
func (h *Handler) ListApplications(c *gin.Context) {
	var apps []models.Application
	if err := h.applicationQuery(c, h.DB.WithContext(c.Request.Context())).
		Preload("Company").
		Preload("Documents").
		Preload("StatusLogs", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at ASC, id ASC")
		}).
		Order("created_at DESC, id DESC").
		Find(&apps).Error; err != nil {
		fail(c, http.StatusInternalServerError, "Не удалось загрузить список заявок")
		return
	}
	for i := range apps {
		if apps[i].StatusLogs == nil {
			apps[i].StatusLogs = make([]models.ApplicationStatusLog, 0)
		}
		if apps[i].Status == models.StatusCounterOffer {
			apps[i].CounterAmount = apps[i].ApprovedAmount
			apps[i].CounterTermMonths = apps[i].ApprovedTermMonths
		}
	}
	c.JSON(http.StatusOK, gin.H{"applications": apps})
}
func (h *Handler) applicationQuery(c *gin.Context, db *gorm.DB) *gorm.DB {
	user := c.MustGet(middleware.UserContextKey).(models.User)
	if user.Role == models.RoleClient {
		if user.INN == nil {
			return db.Where("1 = 0")
		}
		return db.Where("user_id = ? AND company_id IN (?)", user.ID, db.Session(&gorm.Session{NewDB: true}).Model(&models.Company{}).Select("id").Where("inn = ?", *user.INN))
	}
	return db
}
func appID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil || id == 0 {
		fail(c, 400, "Некорректный ID заявки")
		return 0, false
	}
	return uint(id), true
}
func appError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		fail(c, 404, "Заявка не найдена")
	case errors.Is(err, errTransition):
		fail(c, 409, errTransition.Error())
	default:
		fail(c, 500, "Не удалось обработать заявку")
	}
}
func (h *Handler) CreateApplication(c *gin.Context) {
	var req struct {
		ProductID  uint   `json:"product_id" binding:"required"`
		Purpose    string `json:"purpose" binding:"required"`
		Amount     int64  `json:"amount" binding:"required"`
		TermMonths int    `json:"term_months" binding:"required"`
	}
	if !bindJSON(c, &req) {
		return
	}
	product, ok := models.FindProduct(req.ProductID)
	req.Purpose = strings.TrimSpace(req.Purpose)
	if !ok || req.Amount < product.MinAmount || req.Amount > product.MaxAmount || req.TermMonths < product.MinTermMonths || req.TermMonths > product.MaxTermMonths || req.Purpose == "" || len(req.Purpose) > 2000 {
		fail(c, 400, "Проверьте продукт, цель, сумму и срок по каталогу")
		return
	}
	user := c.MustGet(middleware.UserContextKey).(models.User)
	if user.INN == nil {
		fail(c, 404, "Компания не найдена")
		return
	}
	var company models.Company
	if err := h.DB.WithContext(c.Request.Context()).Where("inn = ?", *user.INN).First(&company).Error; err != nil {
		appError(c, err)
		return
	}
	app := models.Application{UserID: user.ID, CompanyID: company.ID, ProductID: product.ID, Purpose: req.Purpose, Status: models.StatusDraft, Amount: req.Amount, TermMonths: req.TermMonths, RequestedAmount: req.Amount, RequestedTermMonths: req.TermMonths}
	if err := h.DB.WithContext(c.Request.Context()).Create(&app).Error; err != nil {
		appError(c, err)
		return
	}
	logStatus(h.DB.WithContext(c.Request.Context()), app.ID, "", string(models.StatusDraft), "Заявка создана клиентом")
	_ = h.DB.WithContext(c.Request.Context()).
		Preload("Company").
		Preload("Documents").
		Preload("StatusLogs", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at ASC, id ASC")
		}).First(&app, app.ID)
	if app.StatusLogs == nil {
		app.StatusLogs = make([]models.ApplicationStatusLog, 0)
	}
	c.JSON(201, app)
}
func (h *Handler) GetApplication(c *gin.Context) {
	id, ok := appID(c)
	if !ok {
		return
	}
	var app models.Application
	if err := h.applicationQuery(c, h.DB.WithContext(c.Request.Context())).
		Preload("Company").
		Preload("Documents").
		Preload("StatusLogs", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at ASC, id ASC")
		}).First(&app, id).Error; err != nil {
		appError(c, err)
		return
	}
	if app.StatusLogs == nil {
		app.StatusLogs = make([]models.ApplicationStatusLog, 0)
	}
	if app.Status == models.StatusCounterOffer {
		app.CounterAmount = app.ApprovedAmount
		app.CounterTermMonths = app.ApprovedTermMonths
	}
	c.JSON(200, app)
}

// All interactive mutations lock the application row and verify its current state.
func (h *Handler) mutate(c *gin.Context, id uint, fn func(*gorm.DB, *models.Application) error) (models.Application, error) {
	var app models.Application
	err := h.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := h.applicationQuery(c, tx).Clauses(clause.Locking{Strength: "UPDATE"}).First(&app, id).Error; err != nil {
			return err
		}
		if err := fn(tx, &app); err != nil {
			return err
		}
		return tx.Save(&app).Error
	})
	if err == nil {
		_ = h.DB.WithContext(c.Request.Context()).
			Preload("Company").
			Preload("Documents").
			Preload("StatusLogs", func(db *gorm.DB) *gorm.DB {
				return db.Order("created_at ASC, id ASC")
			}).First(&app, id)
		if app.StatusLogs == nil {
			app.StatusLogs = make([]models.ApplicationStatusLog, 0)
		}
	}
	return app, err
}
func (h *Handler) SubmitApplication(c *gin.Context) {
	id, ok := appID(c)
	if !ok {
		return
	}
	app, err := h.mutate(c, id, func(tx *gorm.DB, a *models.Application) error {
		if a.Status != models.StatusDraft {
			return errTransition
		}
		fromStatus := string(a.Status)
		a.Status = models.StatusDataEnrichment
		logStatus(tx, a.ID, fromStatus, string(models.StatusScoring), "Заявка отправлена на скоринг рисков")
		return nil
	})
	if err != nil {
		appError(c, err)
		return
	}
	h.runScoring(c, app, false)
}
func (h *Handler) runScoring(c *gin.Context, app models.Application, documents bool) {
	// Finish claimed work even if the browser disconnects, within a bounded timeout.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), 45*time.Second)
	defer cancel()
	db := h.DB.WithContext(ctx)
	var company models.Company
	if err := db.First(&company, app.CompanyID).Error; err != nil {
		h.restoreClaim(db, app, documents)
		appError(c, err)
		return
	}
	// UC 3.1: обогащение данными из локальных моков ФНС/ЕГРЮЛ и БКИ.
	// Моки не перезаписывают уже известные финансовые показатели компании.
	fns := mocks.FNS(company.INN)
	bki := mocks.BKI(company.INN)
	if company.MonthlyRevenue == 0 {
		company.MonthlyRevenue = company.Revenue / 12
	}
	if company.AgeMonths == 0 {
		company.AgeMonths = fns.AgeMonths
	}
	if company.RegistrationDate == nil && fns.RegistrationDate != "" {
		if t, err := time.Parse("2006-01-02", fns.RegistrationDate); err == nil {
			company.RegistrationDate = &t
		}
	}
	if company.OKVED == "" {
		company.OKVED = fns.OKVED
	}
	if company.BkiMonthlyPayment == 0 {
		company.BkiMonthlyPayment = bki.MonthlyPayment
	}
	if company.BkiDelinquencyDays == 0 {
		company.BkiDelinquencyDays = bki.DelinquencyDays
	}
	if !company.HasBankruptcy {
		company.HasBankruptcy = fns.HasBankruptcy || bki.HasBankruptcy
	}
	product, ok := models.FindProduct(app.ProductID)
	if !ok {
		h.restoreClaim(db, app, documents)
		fail(c, 500, "Продукт заявки не найден")
		return
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		// Обновляем только поля обогащения; баланс и прочие данные не трогаем.
		if err := tx.Model(&company).Updates(map[string]any{
			"monthly_revenue":      company.MonthlyRevenue,
			"age_months":           company.AgeMonths,
			"okved":                company.OKVED,
			"registration_date":    company.RegistrationDate,
			"bki_monthly_payment":  company.BkiMonthlyPayment,
			"bki_delinquency_days": company.BkiDelinquencyDays,
			"has_bankruptcy":       company.HasBankruptcy,
		}).Error; err != nil {
			return err
		}
		r := tx.Model(&models.Application{}).Where("id = ? AND status = ?", app.ID, app.Status).Update("status", models.StatusScoring)
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return errTransition
		}
		return nil
	})
	if err != nil {
		h.restoreClaim(db, app, documents)
		appError(c, err)
		return
	}
	input := scoring.Request{CompanyINN: company.INN, MonthlyRevenue: company.MonthlyRevenue, MonthlyNetProfit: company.MonthlyNetProfit, CompanyAgeMonths: company.AgeMonths, RequestedAmount: app.RequestedAmount, RequestedTermMonths: app.RequestedTermMonths, ProductRate: product.InterestRate, BKIMonthlyPayment: company.BkiMonthlyPayment, BKIDelinquencyDays: company.BkiDelinquencyDays, HasBankruptcy: company.HasBankruptcy, DocumentsUploaded: documents}
	result, source := h.Scoring.Evaluate(ctx, input, documents)
	if (result.Decision == models.StatusApproved || result.Decision == models.StatusCounterOffer) && (result.ApprovedTermMonths < product.MinTermMonths || result.ApprovedTermMonths > product.MaxTermMonths || result.ApprovedAmount < product.MinAmount) {
		result = scoring.Fallback(input, documents)
		source = "fallback"
	}
	// Persist with a fresh bounded context even when an ML call exhausted its deadline.
	saveCtx, saveCancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer saveCancel()
	app.Status = result.Decision
	app.ApprovedAmount = result.ApprovedAmount
	app.ApprovedTermMonths = result.ApprovedTermMonths
	app.MonthlyPayment = result.MonthlyPayment
	app.InterestRate = result.InterestRate
	app.ScoreValue = result.ScoreValue
	app.DSTI = result.DSTI
	app.RejectionReason = result.RejectionReason
	app.AIExplanation = result.AIExplanation
	app.ScoringSource = source
	r := h.DB.WithContext(saveCtx).Model(&models.Application{}).Where("id = ? AND status = ?", app.ID, models.StatusScoring).Select("status", "approved_amount", "approved_term_months", "monthly_payment", "interest_rate", "score_value", "dsti", "rejection_reason", "ai_explanation", "scoring_source").Updates(&app)
	if r.Error != nil {
		appError(c, r.Error)
		return
	}
	if r.RowsAffected != 1 {
		appError(c, errTransition)
		return
	}

	fromStatus := string(models.StatusScoring)
	if documents {
		fromStatus = string(models.StatusDocsUploaded)
	}
	comment := result.AIExplanation
	if comment == "" {
		comment = result.RejectionReason
	}
	if comment == "" {
		comment = string(result.Decision)
	}
	logStatus(h.DB.WithContext(saveCtx), app.ID, fromStatus, string(result.Decision), comment)

	if err := h.DB.WithContext(saveCtx).
		Preload("Company").
		Preload("Documents").
		Preload("StatusLogs", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at ASC, id ASC")
		}).First(&app, app.ID).Error; err != nil {
		appError(c, err)
		return
	}
	if app.StatusLogs == nil {
		app.StatusLogs = make([]models.ApplicationStatusLog, 0)
	}
	if app.Status == models.StatusCounterOffer {
		app.CounterAmount = app.ApprovedAmount
		app.CounterTermMonths = app.ApprovedTermMonths
	}
	c.JSON(200, app)
}
func (h *Handler) restoreClaim(db *gorm.DB, app models.Application, documents bool) {
	status := models.StatusDraft
	if documents {
		status = models.StatusDocsRequired
	}
	db.Model(&models.Application{}).Where("id = ? AND status = ?", app.ID, app.Status).Update("status", status)
}
func (h *Handler) CounterOffer(c *gin.Context) {
	var req struct {
		Action string `json:"action" binding:"required,oneof=accept reject"`
	}
	if !bindJSON(c, &req) {
		return
	}
	id, ok := appID(c)
	if !ok {
		return
	}
	app, err := h.mutate(c, id, func(tx *gorm.DB, a *models.Application) error {
		if a.Status != models.StatusCounterOffer {
			return errTransition
		}
		fromStatus := string(a.Status)
		a.Status = models.StatusCancelled
		comment := "Клиент отклонил встречное предложение банка"
		if req.Action == "accept" {
			a.Status = models.StatusApproved
			comment = "Клиент принял встречное предложение банка"
		}
		logStatus(tx, a.ID, fromStatus, string(a.Status), comment)
		return nil
	})
	if err != nil {
		appError(c, err)
		return
	}
	c.JSON(200, app)
}
func (h *Handler) UploadDocuments(c *gin.Context) {
	id, ok := appID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 6<<20)
	if err := c.Request.ParseMultipartForm(6 << 20); err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			fail(c, 413, "Максимальный размер запроса 6 МиБ")
		} else {
			fail(c, 400, "Ожидается multipart/form-data с полем file")
		}
		return
	}
	defer c.Request.MultipartForm.RemoveAll()
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		file, header, err = c.Request.FormFile("document")
	}
	if err != nil {
		fail(c, 400, "Требуется файл в поле file")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, (5<<20)+1))
	if err != nil || len(data) == 0 {
		fail(c, 400, "Файл пуст или недоступен")
		return
	}
	if len(data) > 5<<20 {
		fail(c, 413, "Максимальный размер файла 5 МиБ")
		return
	}
	app, err := h.mutate(c, id, func(tx *gorm.DB, a *models.Application) error {
		if a.Status != models.StatusDocsRequired {
			return errTransition
		}
		doc := models.ApplicationDocument{ApplicationID: id, Filename: filepath.Base(header.Filename), Data: data}
		if err := tx.Create(&doc).Error; err != nil {
			return err
		}
		fromStatus := string(a.Status)
		a.Status = models.StatusDocsUploaded
		logStatus(tx, a.ID, fromStatus, string(models.StatusDocsUploaded), "Клиент загрузил подтверждающие документы: "+doc.Filename)
		return nil
	})
	if err != nil {
		appError(c, err)
		return
	}
	h.runScoring(c, app, true)
}
func (h *Handler) SignApplication(c *gin.Context) {
	var req struct {
		Code string `json:"code" binding:"required"`
	}
	if !bindJSON(c, &req) {
		return
	}
	if req.Code != "1234" {
		fail(c, 400, "Демонстрационный код подписания: 1234")
		return
	}
	id, ok := appID(c)
	if !ok {
		return
	}
	app, err := h.mutate(c, id, func(tx *gorm.DB, a *models.Application) error {
		if a.Status != models.StatusApproved || a.ApprovedAmount <= 0 {
			return errTransition
		}
		fromStatus := string(a.Status)
		a.Status = models.StatusPendingSignature
		if err := tx.Model(a).Update("status", a.Status).Error; err != nil {
			return err
		}
		r := tx.Model(&models.Company{}).Where("id = ?", a.CompanyID).Update("balance", gorm.Expr("balance + ?", a.ApprovedAmount))
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		a.Status = models.StatusIssued
		logStatus(tx, a.ID, fromStatus, string(models.StatusIssued), "Кредитный договор подписан кодом 1234. Средства зачислены на счёт компании")
		return nil
	})
	if err != nil {
		appError(c, err)
		return
	}
	c.JSON(200, app)
}
func (h *Handler) OfficerApplications(c *gin.Context) {
	query := h.DB.WithContext(c.Request.Context()).Model(&models.Application{}).
		Preload("Company").
		Preload("Documents").
		Preload("StatusLogs", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at ASC, id ASC")
		})
	if raw := c.Query("status"); raw != "" {
		statuses := strings.Split(raw, ",")
		for _, s := range statuses {
			if !models.ApplicationStatus(s).Valid() {
				fail(c, 400, "Неизвестный статус")
				return
			}
		}
		query = query.Where("status IN ?", statuses)
	}
	apps := make([]models.Application, 0)
	if err := query.Order("id DESC").Find(&apps).Error; err != nil {
		appError(c, err)
		return
	}
	c.JSON(200, gin.H{"applications": apps})
}
func (h *Handler) OfficerDecision(c *gin.Context) {
	var req struct {
		Decision           string `json:"decision" binding:"required"`
		Amount             *int64 `json:"amount"`
		ApprovedAmount     *int64 `json:"approved_amount"`
		CounterAmount      *int64 `json:"counter_amount"`
		TermMonths         *int   `json:"term_months"`
		ApprovedTermMonths *int   `json:"approved_term_months"`
		CounterTermMonths  *int   `json:"counter_term_months"`
		Comment            string `json:"comment"`
	}
	if !bindJSON(c, &req) {
		return
	}
	decStr := strings.ToUpper(strings.TrimSpace(req.Decision))
	if decStr == "APPROVE" {
		decStr = "APPROVED"
	}
	if decStr == "REJECT" {
		decStr = "REJECTED"
	}
	decision := models.ApplicationStatus(decStr)
	switch decision {
	case models.StatusApproved, models.StatusCounterOffer, models.StatusRejected, models.StatusDocsRequired:
	default:
		fail(c, 400, "Недопустимое решение (допустимо: APPROVED, COUNTER_OFFER, REJECTED, DOCS_REQUIRED)")
		return
	}

	req.Comment = strings.TrimSpace(req.Comment)
	if req.Comment == "" {
		switch decision {
		case models.StatusApproved:
			req.Comment = "Одобрено офицером"
		case models.StatusRejected:
			req.Comment = "Отклонено кредитным офицером"
		case models.StatusCounterOffer:
			req.Comment = "Встречное предложение кредитного офицера"
		default:
			req.Comment = "Решение кредитного офицера"
		}
	}
	if len(req.Comment) > 10000 {
		fail(c, 400, "Требуется комментарий до 10000 байт")
		return
	}
	id, ok := appID(c)
	if !ok {
		return
	}
	invalidTerms := errors.New("invalid terms")
	app, err := h.mutate(c, id, func(tx *gorm.DB, a *models.Application) error {
		switch a.Status {
		case models.StatusScoring, models.StatusManualReview, models.StatusDocsRequired, models.StatusCounterOffer, models.StatusApproved, models.StatusRejected:
		default:
			return errTransition
		}
		p, ok := models.FindProduct(a.ProductID)
		if !ok {
			return invalidTerms
		}
		a.ApprovedAmount = 0
		a.ApprovedTermMonths = 0
		a.MonthlyPayment = 0
		a.RejectionReason = ""
		if decision == models.StatusApproved || decision == models.StatusCounterOffer {
			amount := a.RequestedAmount
			if amount <= 0 {
				amount = a.Amount
			}
			term := a.RequestedTermMonths
			if term <= 0 {
				term = a.TermMonths
			}
			if req.Amount != nil && *req.Amount > 0 {
				amount = *req.Amount
			} else if req.ApprovedAmount != nil && *req.ApprovedAmount > 0 {
				amount = *req.ApprovedAmount
			} else if req.CounterAmount != nil && *req.CounterAmount > 0 {
				amount = *req.CounterAmount
			}

			if req.TermMonths != nil && *req.TermMonths > 0 {
				term = *req.TermMonths
			} else if req.ApprovedTermMonths != nil && *req.ApprovedTermMonths > 0 {
				term = *req.ApprovedTermMonths
			} else if req.CounterTermMonths != nil && *req.CounterTermMonths > 0 {
				term = *req.CounterTermMonths
			}

			if amount < p.MinAmount || amount > p.MaxAmount || term < p.MinTermMonths || term > p.MaxTermMonths {
				return invalidTerms
			}
			if decision == models.StatusCounterOffer && a.RequestedAmount > 0 && amount > a.RequestedAmount {
				return invalidTerms
			}
			a.ApprovedAmount = amount
			a.ApprovedTermMonths = term
			a.InterestRate = p.InterestRate
			a.MonthlyPayment = scoring.Payment(amount, term, p.InterestRate)
		}
		var company models.Company
		if err := tx.First(&company, a.CompanyID).Error; err != nil {
			return err
		}
		a.DSTI = 0
		if company.MonthlyNetProfit > 0 && a.MonthlyPayment > 0 {
			a.DSTI = float64(a.MonthlyPayment+company.BkiMonthlyPayment) / float64(company.MonthlyNetProfit)
		}
		fromStatus := string(a.Status)
		a.Status = decision
		a.OfficerComment = req.Comment
		a.AIExplanation = req.Comment
		if decision == models.StatusRejected {
			a.RejectionReason = req.Comment
		}
		logStatus(tx, a.ID, fromStatus, string(decision), req.Comment)
		return nil
	})
	if errors.Is(err, invalidTerms) {
		fail(c, 400, "Условия решения не соответствуют продукту или заявке")
		return
	}
	if err != nil {
		appError(c, err)
		return
	}
	c.JSON(200, app)
}

func (h *Handler) DownloadDocument(c *gin.Context) {
	id, ok := appID(c)
	if !ok {
		return
	}
	docIDStr := c.Param("doc_id")
	docID, err := strconv.Atoi(docIDStr)
	if err != nil || docID <= 0 {
		fail(c, 400, "Некорректный ID документа")
		return
	}
	var doc models.ApplicationDocument
	if err := h.DB.WithContext(c.Request.Context()).Where("id = ? AND application_id = ?", docID, id).First(&doc).Error; err != nil {
		fail(c, 404, "Документ не найден")
		return
	}
	contentType := "application/octet-stream"
	ext := strings.ToLower(filepath.Ext(doc.Filename))
	switch ext {
	case ".pdf":
		contentType = "application/pdf"
	case ".png":
		contentType = "image/png"
	case ".jpg", ".jpeg":
		contentType = "image/jpeg"
	}
	c.Header("Content-Disposition", fmt.Sprintf("inline; filename=%q", doc.Filename))
	c.Data(http.StatusOK, contentType, doc.Data)
}
