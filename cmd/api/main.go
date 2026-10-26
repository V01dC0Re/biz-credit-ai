package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"biz-credit-ai/internal/auth"
	"biz-credit-ai/internal/config"
	"biz-credit-ai/internal/database"
	"biz-credit-ai/internal/server"
	"github.com/gin-gonic/gin"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	gin.SetMode(os.Getenv("GIN_MODE"))
	db, err := database.Open(cfg.DatabaseURL)
	if err != nil {
		return errors.New("не удалось подключиться к PostgreSQL; проверьте DB_* и доступность БД")
	}
	pool, err := db.DB()
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := database.Migrate(db); err != nil {
		return fmt.Errorf("миграции БД: %w", err)
	}
	if err := database.SeedDatabase(db); err != nil {
		return fmt.Errorf("загрузка демо-данных: %w", err)
	}
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           server.NewRouter(db, auth.NewTokenManager(cfg.JWTSecret), cfg),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	result := make(chan error, 1)
	go func() {
		log.Printf("API запущен на :%s", cfg.Port)
		result <- srv.ListenAndServe()
	}()
	select {
	case err := <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		// Даем текущим запросам завершиться при остановке контейнера.
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdown)
	}
}
