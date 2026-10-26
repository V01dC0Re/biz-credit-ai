package server

import (
	"context"
	"net/http"
	"time"

	"biz-credit-ai/internal/auth"
	"biz-credit-ai/internal/config"
	"biz-credit-ai/internal/handler"
	"biz-credit-ai/internal/handlers"
	"biz-credit-ai/internal/middleware"
	"biz-credit-ai/internal/models"
	"biz-credit-ai/internal/scoring"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const swaggerUIHTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Alfa Biz Credit AI - API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5/favicon-32x32.png" />
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "/openapi.yaml",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "StandaloneLayout"
      });
    };
  </script>
</body>
</html>`

func NewRouter(db *gorm.DB, tokens *auth.TokenManager, cfg ...*config.Config) *gin.Engine {
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	// Не доверяем произвольным X-Forwarded-For без явно настроенного прокси.
	_ = r.SetTrustedProxies(nil)

	r.GET("/healthz", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		pool, err := db.DB()
		if err != nil || pool.PingContext(ctx) != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.GET("/openapi.yaml", func(c *gin.Context) {
		c.Header("Content-Type", "application/yaml")
		c.File("openapi.yaml")
	})
	r.GET("/docs", func(c *gin.Context) {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.String(http.StatusOK, swaggerUIHTML)
	})

	h := &handlers.Handler{DB: db, Tokens: tokens}
	authRoutes := r.Group("/api/auth")
	authRoutes.POST("/register", h.Register)
	authRoutes.POST("/login", h.Login)

	// Локальные моки внешних сервисов (UC 3.1): ФНС/ЕГРЮЛ и БКИ.
	// Воспроизводят контракт интеграций без доступа к корпоративным системам.
	mockRoutes := r.Group("/internal/mocks")
	mockRoutes.GET("/fns/:inn", h.MockFNS)
	mockRoutes.GET("/bki/:inn", h.MockBKI)

	dashboard := r.Group("/api/dashboard", middleware.AuthMiddleware(db, tokens))
	dashboard.GET("", h.Dashboard)
	dashboard.GET("/", h.Dashboard)

	// AI financial advisor routes
	var appCfg *config.Config
	if len(cfg) > 0 && cfg[0] != nil {
		appCfg = cfg[0]
	} else {
		appCfg = &config.Config{
			Server: config.ServerConfig{Addr: "0.0.0.0", Port: "8080"},
			AI: config.AIConfig{
				BaseURL: "http://10.154.0.1:8080/v1",
				Model:   "gemma4:12b",
				Timeout: 30,
			},
		}
	}
	h.Scoring = scoring.New(appCfg.ScoringBaseURL)
	client := r.Group("/api", middleware.AuthMiddleware(db, tokens), handlers.RequireRole(models.RoleClient))
	client.GET("/products", h.Products)
	// UC 1.3: автозаполнение реквизитов по ИНН через мок ФНС/ЕГРЮЛ.
	client.GET("/company/lookup", h.CompanyLookup)
	client.GET("/applications", h.ListApplications)
	client.POST("/applications", h.CreateApplication)
	client.GET("/applications/:id", h.GetApplication)
	client.POST("/applications/:id/submit", h.SubmitApplication)
	client.POST("/applications/:id/counter-offer", h.CounterOffer)
	client.POST("/applications/:id/documents", h.UploadDocuments)
	client.POST("/applications/:id/sign", h.SignApplication)
	officer := r.Group("/api/officer", middleware.AuthMiddleware(db, tokens), handlers.RequireRole(models.RoleOfficer))
	officer.GET("/applications", h.OfficerApplications)
	officer.POST("/applications/:id/decision", h.OfficerDecision)
	r.GET("/api/applications/:id/documents/:doc_id", middleware.AuthMiddleware(db, tokens), h.DownloadDocument)
	handler.RegisterRoutes(r, appCfg)

	r.NoRoute(func(c *gin.Context) { c.JSON(http.StatusNotFound, gin.H{"error": "Маршрут не найден"}) })
	return r
}
