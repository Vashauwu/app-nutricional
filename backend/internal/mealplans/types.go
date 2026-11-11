// Package mealplans implementa planes alimentarios: calendario, publicación, sustituciones, plantillas e
// historial (MVP_SPEC §9–§11). La paciente solo ve planes PUBLICADOS y propios.
package mealplans

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/nutri/app-nutricional/backend/internal/nutrition_engine/calculator"
)

// DefaultSlots son los tiempos de comida predeterminados (§9.1).
var DefaultSlots = []string{"Desayuno", "Colación matutina", "Comida", "Colación vespertina", "Cena"}

// ---------- Entrada (documento editable) ----------
type Targets struct {
	Energy      decimal.Decimal            `json:"energy_kcal"`
	Protein     decimal.Decimal            `json:"protein_g"`
	Carbs       decimal.Decimal            `json:"carbohydrates_g"`
	Lipids      decimal.Decimal            `json:"lipids_g"`
	Equivalents map[string]decimal.Decimal `json:"equivalents"`
}

type Item struct {
	ID           uuid.UUID       `json:"id"`
	DishID       uuid.UUID       `json:"dish_id"`
	DishVersion  int32           `json:"dish_version"`
	Servings     decimal.Decimal `json:"servings"`
	Instructions string          `json:"instructions"`
}

type Slot struct {
	ID    uuid.UUID `json:"id"`
	Name  string    `json:"name"`
	Items []Item    `json:"items"`
}

type Day struct {
	Date  string `json:"date"` // AAAA-MM-DD
	Notes string `json:"notes"`
	Slots []Slot `json:"slots"`
}

// Document es lo que se guarda en una revisión y lo que envía el editor.
type Document struct {
	Name    string  `json:"name"`
	Targets Targets `json:"targets"`
	Days    []Day   `json:"days"`
}

// ---------- Salida (enriquecida con platillo y nutrición) ----------
type Totals struct {
	Nutrients   calculator.Nutrients       `json:"nutrients"`
	Equivalents map[string]decimal.Decimal `json:"equivalents"`
}

type ItemView struct {
	ID            uuid.UUID            `json:"id"`
	DishID        uuid.UUID            `json:"dish_id"`
	DishName      string               `json:"dish_name"`
	DishCategory  string               `json:"dish_category"`
	DishInactive  bool                 `json:"dish_inactive"`
	DishVersion   int32                `json:"dish_version"`
	LatestVersion int32                `json:"latest_version"`
	Servings      decimal.Decimal      `json:"servings"`
	Instructions  string               `json:"instructions"`
	PerServing    calculator.Nutrients `json:"per_serving"`
	Totals        Totals               `json:"totals"`
}

type SlotView struct {
	ID     uuid.UUID  `json:"id"`
	Name   string     `json:"name"`
	Items  []ItemView `json:"items"`
	Totals Totals     `json:"totals"`
}

type DayView struct {
	Date   string     `json:"date"`
	Notes  string     `json:"notes"`
	Slots  []SlotView `json:"slots"`
	Totals Totals     `json:"totals"`
}

type PlanView struct {
	ID             uuid.UUID `json:"id"`
	PatientID      uuid.UUID `json:"patient_id"`
	PatientName    string    `json:"patient_name,omitempty"`
	Name           string    `json:"name"`
	Status         string    `json:"status"`
	StartDate      string    `json:"start_date"`
	EndDate        string    `json:"end_date"`
	Revision       int32     `json:"revision"`
	Targets        Targets   `json:"targets"`
	TargetsVersion int32     `json:"targets_version"`
	Days           []DayView `json:"days"`
	UpdatedAt      time.Time `json:"updated_at"`
	CreatedAt      time.Time `json:"created_at"`
	ReadOnly       bool      `json:"read_only"`
}

type ListItem struct {
	ID          uuid.UUID `json:"id"`
	PatientID   uuid.UUID `json:"patient_id"`
	PatientName string    `json:"patient_name"`
	Name        string    `json:"name"`
	Status      string    `json:"status"`
	StartDate   string    `json:"start_date"`
	EndDate     string    `json:"end_date"`
	Revision    int32     `json:"revision"`
	ItemCount   int64     `json:"item_count"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type ListResult struct {
	Items    []ListItem `json:"items"`
	Total    int64      `json:"total"`
	Page     int        `json:"page"`
	PageSize int        `json:"page_size"`
}

type EventView struct {
	ID      uuid.UUID  `json:"id"`
	At      time.Time  `json:"at"`
	Actor   *uuid.UUID `json:"actor"`
	Type    string     `json:"type"`
	Summary string     `json:"summary"`
}

type PublicationView struct {
	VersionNumber int32     `json:"version_number"`
	Revision      int32     `json:"revision"`
	PublishedAt   time.Time `json:"published_at"`
	Summary       string    `json:"summary"`
}

type RevisionView struct {
	Revision int32     `json:"revision"`
	SavedAt  time.Time `json:"saved_at"`
}

type History struct {
	Events       []EventView       `json:"events"`
	Publications []PublicationView `json:"publications"`
	Revisions    []RevisionView    `json:"revisions"`
}

type TemplateView struct {
	ID          uuid.UUID  `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Scope       string     `json:"scope"`
	PatientID   *uuid.UUID `json:"patient_id"`
	Days        int        `json:"days"`
	CreatedAt   time.Time  `json:"created_at"`
}

// templateStructure es el contenido de una plantilla (días relativos al inicio).
type templateDay struct {
	Offset int            `json:"offset"`
	Slots  []templateSlot `json:"slots"`
}
type templateSlot struct {
	Name  string         `json:"name"`
	Items []templateItem `json:"items"`
}
type templateItem struct {
	DishID       uuid.UUID       `json:"dish_id"`
	DishVersion  int32           `json:"dish_version"`
	Servings     decimal.Decimal `json:"servings"`
	Instructions string          `json:"instructions"`
}
