package models

import "time"

type Role string

const (
	RoleClient  Role = "client"
	RoleOfficer Role = "officer"
)

type ApplicationStatus string

const (
	StatusDraft            ApplicationStatus = "DRAFT"
	StatusDataEnrichment   ApplicationStatus = "DATA_ENRICHMENT"
	StatusScoring          ApplicationStatus = "SCORING_IN_PROGRESS"
	StatusSubmitted        ApplicationStatus = StatusDataEnrichment // compatibility for existing callers
	StatusApproved         ApplicationStatus = "APPROVED"
	StatusCounterOffer     ApplicationStatus = "COUNTER_OFFER"
	StatusDocsRequired     ApplicationStatus = "DOCS_REQUIRED"
	StatusDocsUploaded     ApplicationStatus = "DOCS_UPLOADED"
	StatusManualReview     ApplicationStatus = "MANUAL_REVIEW"
	StatusRejected         ApplicationStatus = "REJECTED"
	StatusPendingSignature ApplicationStatus = "PENDING_SIGNATURE"
	StatusIssued           ApplicationStatus = "ISSUED"
	StatusCancelled        ApplicationStatus = "CANCELLED_BY_CLIENT"
)

func (s ApplicationStatus) Valid() bool {
	switch s {
	case StatusDraft, StatusDataEnrichment, StatusScoring, StatusApproved, StatusCounterOffer, StatusDocsRequired, StatusDocsUploaded, StatusManualReview, StatusRejected, StatusPendingSignature, StatusIssued, StatusCancelled:
		return true
	}
	return false
}

type User struct {
	ID           uint   `gorm:"primaryKey" json:"id"`
	Email        string `gorm:"size:254;not null;uniqueIndex" json:"email"`
	PasswordHash string `gorm:"not null" json:"-"`
	Role         Role   `gorm:"size:16;not null;check:role IN ('client','officer')" json:"role"`
	// Сотрудник банка не привязан к компании; у клиента ИНН обязателен.
	INN     *string  `gorm:"size:12;index" json:"inn"`
	Company *Company `gorm:"belongsTo:Company;foreignKey:INN;references:INN;constraint:OnUpdate:CASCADE,OnDelete:RESTRICT" json:"-"`
}

type Company struct {
	ID    uint   `gorm:"primaryKey" json:"id"`
	INN   string `gorm:"size:12;not null;uniqueIndex" json:"inn"`
	Name  string `gorm:"not null" json:"name"`
	OKVED string `gorm:"size:16;not null" json:"okved"`
	// Денежные величины демо хранятся в целых рублях, без float.
	MonthlyRevenue     int64      `gorm:"not null;default:0" json:"monthly_revenue"`
	MonthlyNetProfit   int64      `gorm:"not null;default:0" json:"monthly_net_profit"`
	AgeMonths          int        `gorm:"not null;default:0" json:"company_age_months"`
	BkiMonthlyPayment  int64      `gorm:"not null;default:0" json:"bki_active_loans_monthly_payment"`
	BkiDelinquencyDays int        `gorm:"not null;default:0" json:"bki_delinquency_days"`
	HasBankruptcy      bool       `gorm:"not null;default:false" json:"has_bankruptcy"`
	Balance            int64      `gorm:"not null;default:0" json:"balance"`
	Revenue            int64      `gorm:"not null;check:revenue >= 0" json:"revenue"`
	RegistrationDate   *time.Time `gorm:"type:date" json:"registration_date"`
}

type Application struct {
	ProductID           uint                   `gorm:"not null;default:2" json:"product_id"`
	Purpose             string                 `gorm:"not null;default:''" json:"purpose"`
	RequestedAmount     int64                  `gorm:"not null;default:0" json:"requested_amount"`
	RequestedTermMonths int                    `gorm:"not null;default:0" json:"requested_term_months"`
	ApprovedAmount      int64                  `gorm:"not null;default:0" json:"approved_amount"`
	ApprovedTermMonths  int                    `gorm:"not null;default:0" json:"approved_term_months"`
	CounterAmount       int64                  `gorm:"-" json:"counter_amount,omitempty"`
	CounterTermMonths   int                    `gorm:"-" json:"counter_term_months,omitempty"`
	MonthlyPayment      int64                  `gorm:"not null;default:0" json:"monthly_payment"`
	InterestRate        float64                `gorm:"not null;default:0" json:"interest_rate"`
	ScoreValue          float64                `gorm:"not null;default:0" json:"score_value"`
	DSTI                float64                `gorm:"not null;default:0" json:"dsti"`
	RejectionReason     string                 `gorm:"type:text;not null;default:''" json:"rejection_reason"`
	AIExplanation       string                 `gorm:"type:text;not null;default:''" json:"ai_explanation"`
	OfficerComment      string                 `gorm:"type:text;not null;default:''" json:"officer_comment"`
	ScoringSource       string                 `gorm:"not null;default:''" json:"scoring_source"`
	CreatedAt           time.Time              `json:"created_at"`
	UpdatedAt           time.Time              `json:"updated_at"`
	ID                  uint                   `gorm:"primaryKey" json:"id"`
	UserID              uint                   `gorm:"not null;index" json:"user_id"`
	User                User                   `gorm:"constraint:OnDelete:RESTRICT" json:"-"`
	CompanyID           uint                   `gorm:"not null;index" json:"company_id"`
	Company             *Company               `gorm:"foreignKey:CompanyID;constraint:OnDelete:RESTRICT" json:"company,omitempty"`
	Documents           []ApplicationDocument  `gorm:"foreignKey:ApplicationID;constraint:OnDelete:RESTRICT" json:"documents,omitempty"`
	StatusLogs          []ApplicationStatusLog `gorm:"foreignKey:ApplicationID;constraint:OnDelete:CASCADE" json:"status_logs"`
	Status              ApplicationStatus      `gorm:"size:32;not null;index;check:status IN ('DRAFT','DATA_ENRICHMENT','SCORING_IN_PROGRESS','APPROVED','COUNTER_OFFER','DOCS_REQUIRED','DOCS_UPLOADED','MANUAL_REVIEW','REJECTED','PENDING_SIGNATURE','ISSUED','CANCELLED_BY_CLIENT')" json:"status"`
	Amount              int64                  `gorm:"not null;check:amount > 0" json:"amount"`
	TermMonths          int                    `gorm:"not null;check:term_months > 0" json:"term_months"`
}

type NewsArticle struct {
	ID          uint    `gorm:"primaryKey" json:"id"`
	Title       string  `gorm:"not null" json:"title"`
	Content     string  `gorm:"type:text;not null" json:"content"`
	TargetOKVED *string `gorm:"size:16;index" json:"target_okved"`
}

// Documents are synthetic demo attachments, stored transactionally with the application.
type ApplicationDocument struct {
	ID            uint        `gorm:"primaryKey" json:"id"`
	ApplicationID uint        `gorm:"not null;index" json:"application_id"`
	Application   Application `gorm:"constraint:OnDelete:RESTRICT" json:"-"`
	Filename      string      `json:"filename"`
	Data          []byte      `gorm:"not null" json:"-"`
	CreatedAt     time.Time   `json:"created_at"`
}

type ApplicationStatusLog struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	ApplicationID uint      `gorm:"index;not null" json:"application_id"`
	FromStatus    string    `gorm:"size:32;not null;default:''" json:"from_status"`
	ToStatus      string    `gorm:"size:32;not null" json:"to_status"`
	Comment       string    `gorm:"type:text;not null;default:''" json:"comment"`
	CreatedAt     time.Time `json:"created_at"`
}
