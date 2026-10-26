// Package mocks содержит локальные симуляторы внешних государственных и
// кредитных сервисов, требуемые ТЗ (UC 3.1): ФНС/ЕГРЮЛ и БКИ.
//
// Реальные интеграции недоступны в контуре хакатона, поэтому обогащение заявки
// воспроизводится детерминированными моками. Для известных ИНН возвращаются
// синтетические данные из каталога, для остальных — стабильно сгенерированные
// по ИНН (один и тот же ИНН всегда даёт один и тот же результат).
package mocks

import (
	"hash/fnv"
	"time"
)

// FNSRecord — ответ мока ФНС/ЕГРЮЛ «Прозрачный бизнес».
type FNSRecord struct {
	INN              string `json:"inn"`
	Name             string `json:"name"`
	OKVED            string `json:"okved"`
	RegistrationDate string `json:"registration_date"`
	AgeMonths        int    `json:"company_age_months"`
	Status           string `json:"status"`
	HasBankruptcy    bool   `json:"has_bankruptcy"`
	Source           string `json:"source"`
}

// BKIRecord — ответ мока бюро кредитных историй.
type BKIRecord struct {
	INN                string `json:"inn"`
	ActiveLoans        int    `json:"active_loans"`
	MonthlyPayment     int64  `json:"bki_active_loans_monthly_payment"`
	DelinquencyDays    int    `json:"bki_delinquency_days"`
	HasBankruptcy      bool   `json:"has_bankruptcy"`
	CreditHistoryScore int    `json:"credit_history_score"`
	Source             string `json:"source"`
}

// fnsCatalog — синтетические данные по известным ИНН (совпадают с seed БД).
var fnsCatalog = map[string]FNSRecord{
	"7701000001": {
		INN: "7701000001", Name: `ООО "Стабильный Бизнес"`, OKVED: "62.01",
		RegistrationDate: "2018-04-10", AgeMonths: 102, Status: "ACTIVE",
	},
	"770100000002": {
		INN: "770100000002", Name: `ИП "Ритейл"`, OKVED: "47.11",
		RegistrationDate: "2021-08-15", AgeMonths: 62, Status: "ACTIVE",
	},
	"770100000003": {
		INN: "770100000003", Name: `ИП "Новый"`, OKVED: "62.01",
		RegistrationDate: "2026-09-01", AgeMonths: 1, Status: "ACTIVE",
	},
}

// bkiCatalog — синтетическая кредитная история по известным ИНН.
var bkiCatalog = map[string]BKIRecord{
	"7701000001": {
		INN: "7701000001", ActiveLoans: 1, MonthlyPayment: 50000,
		DelinquencyDays: 0, CreditHistoryScore: 780,
	},
	"770100000002": {
		INN: "770100000002", ActiveLoans: 1, MonthlyPayment: 40000,
		DelinquencyDays: 0, CreditHistoryScore: 690,
	},
	"770100000003": {
		INN: "770100000003", ActiveLoans: 0, MonthlyPayment: 0,
		DelinquencyDays: 0, CreditHistoryScore: 0,
	},
}

// hashINN даёт стабильное число из ИНН для генерации синтетики.
func hashINN(inn string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(inn))
	return h.Sum32()
}

// FNS возвращает данные ФНС/ЕГРЮЛ по ИНН. Для неизвестных ИНН генерирует
// детерминированную запись, чтобы демо работало с любым вводом.
func FNS(inn string) FNSRecord {
	if rec, ok := fnsCatalog[inn]; ok {
		rec.Source = "mock-fns"
		return rec
	}
	h := hashINN(inn)
	ageMonths := int(h%120) + 1
	reg := time.Now().AddDate(0, -ageMonths, 0).Format("2006-01-02")
	okveds := []string{"62.01", "47.11", "46.90", "25.11", "10.71"}
	return FNSRecord{
		INN:              inn,
		Name:             "ООО \"Компания " + inn[len(inn)-4:] + "\"",
		OKVED:            okveds[int(h)%len(okveds)],
		RegistrationDate: reg,
		AgeMonths:        ageMonths,
		Status:           "ACTIVE",
		HasBankruptcy:    h%17 == 0, // ~6% синтетических банкротств
		Source:           "mock-fns",
	}
}

// BKI возвращает кредитную историю по ИНН. Для неизвестных ИНН генерирует
// детерминированную запись.
func BKI(inn string) BKIRecord {
	if rec, ok := bkiCatalog[inn]; ok {
		rec.Source = "mock-bki"
		return rec
	}
	h := hashINN(inn)
	activeLoans := int(h % 3)
	var payment int64
	if activeLoans > 0 {
		payment = int64((h%20)+1) * 10000
	}
	delinquency := 0
	switch h % 10 {
	case 0:
		delinquency = 120 // редкий стоп-фактор
	case 1, 2:
		delinquency = int(h%30) + 1
	}
	return BKIRecord{
		INN:                inn,
		ActiveLoans:        activeLoans,
		MonthlyPayment:     payment,
		DelinquencyDays:    delinquency,
		HasBankruptcy:      h%17 == 0,
		CreditHistoryScore: int(h % 1000),
		Source:             "mock-bki",
	}
}
