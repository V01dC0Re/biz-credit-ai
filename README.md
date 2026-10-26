# BizCredit AI — Умный кредитный кабинет предпринимателя

AI-ассистент и бэкенд кредитного кабинета для Альфа-Банка. Помогает клиентам бизнеса понимать кредитные продукты, получать персональные финансовые советы, отслеживать статус кредитных заявок и объяснять банковские решения.

API реализован на Go (Gin, PostgreSQL, GORM, JWT, интеграция с LLM).

---

## Архитектура проекта

```
biz-credit-ai/
├── cmd/
│   └── api/                  # Точка входа приложения (HTTP-сервер, graceful shutdown)
├── internal/
│   ├── ai/                   # Клиент для AI API (OpenAI-compatible)
│   │   ├── client.go         # HTTP-клиент к языковой модели
│   │   └── prompts.go        # Шаблоны промптов для финансовых сценариев
│   ├── auth/                 # Генерация и валидация JWT-токенов
│   ├── config/               # Конфигурация приложения (.env, валидация, параметры БД и AI)
│   ├── database/             # Подключение к PostgreSQL, AutoMigrate и сидинг демо-данных
│   ├── domain/               # Доменные DTO-модели для AI-советов и сценариев
│   ├── handler/              # HTTP-обработчики AI-советов (/api/v1/advice/*)
│   ├── handlers/             # HTTP-обработчики аутентификации и дашборда (/api/auth, /api/dashboard)
│   ├── middleware/           # Middleware авторизации (JWT Bearer)
│   ├── models/               # GORM-модели базы данных (User, Company, Application, NewsArticle)
│   ├── router/               # Базовый роутер
│   ├── scoring/              # Go-клиент к сервису скоринга + demo-fallback
│   ├── server/               # Сборка общего роутера и интеграционные тесты
│   └── service/              # Сервисный слой AI финансовых советов
├── scoring_service/          # Python-микросервис скоринга (FastAPI) + объяснения LLM
│   ├── app.py                # HTTP-эндпоинт POST /api/v1/scoring/evaluate
│   ├── engine.py             # DSTI, скоринг-балл и логика 5 небинарных исходов
│   ├── llm.py                # Объяснение решения простым языком (fallback на шаблон)
│   └── schemas.py            # Входной/выходной контракт API
├── task/                     # Материалы задания хакатона
├── Dockerfile                # Multi-stage сборка контейнера API
├── Dockerfile.scoring        # Сборка контейнера сервиса скоринга
├── docker-compose.yml        # Развертывание PostgreSQL, API, скоринга и фронтенда
├── Makefile                  # Команды сборки, запуска и тестирования
├── BACKEND_API.md            # Детальная спецификация БД и авторизации
└── README.md
```

---

## Быстрый запуск

### Вариант 1. Docker Compose (рекомендуется)

Требуется Docker Engine с Docker Compose v2.

```sh
cp .env.example .env
# Задайте WG_PRIVATE_KEY, собственные JWT_SECRET и DB_PASSWORD
docker compose up --build -d
```

Для доступа к Gemma задайте `WG_PRIVATE_KEY` в локальном `.env` (не в
`.env.example`). Остальные параметры WireGuard уже настроены. Не включайте
этот туннель одновременно на двух машинах с одним ключом.

Скоринг отправляет запрос объяснения в `http://llm-proxy:8080/v1/chat/completions`,
а прокси передаёт его через WireGuard в `10.154.0.1:8080`. Без ключа Compose
сообщит об ошибке; при ошибке запуска туннеля контейнер прокси завершится с
ошибкой. Состояние можно проверить командами `docker compose ps` и
`docker compose logs llm-proxy scoring`.

Расчёт решения выполняет движок скоринга, LLM формирует объяснение. При ошибке
или таймауте запроса LLM остаётся резервное шаблонное объяснение с записью в лог.
Статус healthcheck прокси проверяет локальный туннель и TCP-прокси, но не
гарантирует доступность удалённой модели.

Проверка работоспособности:
```sh
curl http://localhost:8080/healthz
```

Остановка:
```sh
docker compose down
```

#### Домен fortis-ss.ru

Nginx фронтенда настроен на `fortis-ss.ru`. Docker Compose публикует его на
порту 80 (можно переопределить через `FRONTEND_PORT` в `.env`). Запросы `/api/`
передаются в контейнер бэкенда.

Для запуска на сервере:

1. Направьте DNS-запись `A` для `fortis-ss.ru` на публичный IPv4 сервера.
2. Освободите порт 80 и разрешите входящие TCP-подключения на этот порт.
3. Задайте собственные `JWT_SECRET` и `DB_PASSWORD` в `.env`.
4. Выполните `docker compose up --build -d`.

Сайт будет доступен по `http://fortis-ss.ru`. HTTPS пока не настроен:
для него потребуется TLS-сертификат и настройка порта 443 в Nginx либо
внешний прокси с TLS.

### Вариант 2. Локальный запуск

#### Требования
- Go 1.26+
- Запущенный PostgreSQL (по умолчанию порт 5432)
- Доступ к AI API (по умолчанию `http://10.154.0.1:8080/v1`)

#### Запуск
```sh
cp .env.example .env
go mod download
go run ./cmd/api/
```

Сервер запустится на `http://localhost:8080`.

---

## Переменные окружения

```bash
# Сервер
PORT=8080
SERVER_ADDR=0.0.0.0
SERVER_PORT=8080
GIN_MODE=release

# База данных PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_USER=alfa
DB_PASSWORD=alfa_2026
DB_NAME=alfa_credit
DB_SSLMODE=disable

# JWT Аутентификация
JWT_SECRET=local-demo-only-change-this-secret-32-bytes

# AI API (OpenAI-совместимый эндпоинт, например Gemma / vLLM / Ollama)
AI_BASE_URL=http://10.154.0.1:8080/v1
AI_MODEL=gemma4:12b
AI_API_KEY=
AI_TIMEOUT=30

# Сервис скоринга (Python). Пусто -> Go использует demo-правила.
SCORING_BASE_URL=http://scoring:8000
SCORING_PORT=8000
SCORING_AI_TIMEOUT=30.0
DSTI_APPROVE_MAX=0.35
DSTI_COUNTER_MAX=0.55
```

---

## Сервис скоринга (Python)

Отдельный микросервис (FastAPI) делает оценку риска прозрачной: считает DSTI,
принимает **небинарное** решение (APPROVED / COUNTER_OFFER / DOCS_REQUIRED /
MANUAL_REVIEW / REJECTED), подбирает безопасные условия и просит LLM объяснить
решение простым языком.

- **POST** `/api/v1/scoring/evaluate` — оценка заявки (контракт для Go-бэкенда).
- **GET** `/healthz` — проверка живости.
- Полная документация: [scoring_service/README.md](scoring_service/README.md).

Go-бэкенд вызывает сервис, когда задан `SCORING_BASE_URL`; при недоступности
автоматически откатывается на demo-правила (`internal/scoring/client.go`).

---

## Демо-пользователи

После первого старта база данных автоматически инициализируется демонстрационными пользователями:
- `client1`, `client2`, `client3` (роль: `client`, пароль: `123`)
- `officer1` (роль: `officer`, кредитный офицер, пароль: `123`)

---

## API Эндпоинты

### 1. Сервисные проверки (Health Checks)
- **GET** `/healthz` — проверка состояния сервиса и доступности подключения к PostgreSQL.
- **GET** `/health` — проверка доступности HTTP API.

### 2. Аутентификация и Дашборд
Подробная документация по авторизации и форматам ответов доступна в [BACKEND_API.md](BACKEND_API.md).
- **POST** `/api/auth/register` — регистрация нового клиента бизнеса.
- **POST** `/api/auth/login` — вход в систему и получение JWT-токена.
- **GET** `/api/dashboard` — получение информации о компании, активной кредитной заявке и персонализированной ленте новостей (требуется Bearer-токен).

### 3. Кредитный конвейер и кабинет риск-офицера

Полные контракты, JSON-примеры, статусы, ошибки, демо-сценарии и ML-интеграция: [APPLICATIONS_API.md](APPLICATIONS_API.md).

- Клиент: `GET /api/products`, `POST /api/applications`, `GET /api/applications/:id`.
- Действия: `POST /api/applications/:id/submit`, `/counter-offer`, `/documents`, `/sign`.
- Офицер: `GET /api/officer/applications?status=MANUAL_REVIEW`, `POST /api/officer/applications/:id/decision`.
- `SCORING_BASE_URL=http://localhost:8000` подключает ML; пустое значение включает демо-правила.
- В Docker укажите адрес ML, доступный из контейнера (например `http://ml:8000` для сервиса в одной сети).

### 4. AI Финансовый советник

#### Сравнение кредитных продуктов
**POST** `/api/v1/advice/compare`

Объясняет различия между кредитными продуктами простыми словами.

```json
{
  "product_a": "overdraft",
  "product_b": "revolving_credit"
}
```

**Response:**
```json
{
  "type": "comparison",
  "product_a": "overdraft",
  "product_b": "revolving_credit",
  "advice": "Овердрафт — это как страховка на вашем счете..."
}
```

#### Контекстная подсказка при оформлении
**POST** `/api/v1/advice/contextual`

Анализ финансовых параметров бизнеса и предоставление рекомендации по кредиту.

```json
{
  "client_id": "client_123",
  "revenue": 5000000,
  "net_profit": 800000,
  "requested_amount": 3000000,
  "requested_term": 6,
  "payment_type": "monthly",
  "credit_product": "term_loan",
  "context": "Нужны средства на закупку товара"
}
```

**Response:**
```json
{
  "type": "contextual_advice",
  "client": "client_123",
  "advice": "Ежемесячный платёж составляет 40% вашей чистой прибыли..."
}
```

#### Объяснение банковского решения
**POST** `/api/v1/advice/explain-decision`

Объясняет причины отказа или встречного предложения понятным языком.

```json
{
  "decision_type": "counter_offer",
  "original_amount": 5000000,
  "original_term": 6,
  "counter_amount": 3000000,
  "counter_term": 12,
  "reasons": [
    "Высокая нагрузка на денежный поток",
    "Краткосрочный период погашения"
  ]
}
```

**Response:**
```json
{
  "type": "decision_explanation",
  "decision": "counter_offer",
  "explanation": "Банк предлагает снизить сумму кредита и увеличить срок..."
}
```

---

## Тестирование

```sh
# Запуск модульных тестов
make test

# Запуск интеграционных тестов с живым PostgreSQL:
TEST_DATABASE_URL="postgres://alfa:alfa_2026@localhost:5432/alfa_credit?sslmode=disable" go test -v ./internal/server
```
