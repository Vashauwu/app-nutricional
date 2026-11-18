// Package plans define los planes de la plataforma, sus límites y el uso actual de cada consulta.
package plans

import "errors"

// Unlimited marca un límite sin tope.
const Unlimited = -1

type Plan struct {
	Code string `json:"code"`
	Name string `json:"name"`
	// Tagline: para quién es el plan.
	Tagline string `json:"tagline"`
	// Precios en pesos mexicanos con IVA incluido (0 = gratis).
	MonthlyMXN int    `json:"monthly_mxn"`
	AnnualMXN  int    `json:"annual_mxn"`
	Limits     Limits `json:"limits"`
	Perks      Perks  `json:"perks"`
	// Features es la lista que se muestra en la pantalla de facturación. Solo debe anunciar lo que el sistema ya cumple o limita.
	Features []string `json:"features"`
}

type Limits struct {
	ActivePatients int   `json:"active_patients"` // Unlimited = sin tope
	StorageBytes   int64 `json:"storage_bytes"`   // Unlimited = sin tope
	TrackingPhotos bool  `json:"tracking_photos"`
}

// Perks son funciones que cambian según el plan (no son cupos). El documento del paciente se arma en el navegador, así que
// aquí no se puede forzar en el servidor: la interfaz las refleja y la regla vive en un solo lugar.
type Perks struct {
	// PlatformMark: el documento del paciente lleva la marca de la plataforma y no se puede quitar.
	PlatformMark bool `json:"platform_mark"`
	// AllHandoutStyles: los cuatro estilos del documento (Gratuito: solo el clásico).
	AllHandoutStyles bool `json:"all_handout_styles"`
	// CustomAccent: color de acento propio en el documento (Gratuito: el de la marca por omisión).
	CustomAccent bool `json:"custom_accent"`
}

const mb = 1 << 20
const gb = 1 << 30

// Catalog: precios y límites de lanzamiento. Cambiarlos aquí los cambia en la pantalla y en la validación.
var Catalog = []Plan{
	{
		Code: "free", Name: "Gratuito", Tagline: "Para empezar a atender con orden, sin costo.",
		MonthlyMXN: 0, AnnualMXN: 0,
		Limits: Limits{ActivePatients: 15, StorageBytes: 300 * mb, TrackingPhotos: false},
		Perks:  Perks{PlatformMark: true, AllHandoutStyles: false, CustomAccent: false},
		Features: []string{
			"Hasta 15 pacientes activos", "Expediente, mediciones y consentimientos", "Dietocálculo y planes semanales",
			"Biblioteca de platillos y catálogo SMAE", "Agenda, seguimiento, alertas y reportes", "Documento del paciente (PDF y WhatsApp) con la marca de la plataforma y estilo clásico", "300 MB de archivos",
		},
	},
	{
		Code: "standard", Name: "Estándar", Tagline: "Para la consulta que ya crece.",
		MonthlyMXN: 299, AnnualMXN: 2870,
		Limits: Limits{ActivePatients: 80, StorageBytes: 5 * gb, TrackingPhotos: true},
		Perks:  Perks{PlatformMark: false, AllHandoutStyles: true, CustomAccent: true},
		Features: []string{
			"Hasta 80 pacientes activos", "Todo lo del plan Gratuito", "Fotografías de seguimiento de los pacientes", "Documento del paciente sin marca de la plataforma, con los 4 estilos y tu color", "5 GB de archivos",
		},
	},
	{
		Code: "pro", Name: "Pro", Tagline: "Para consultas con mucha actividad.",
		MonthlyMXN: 549, AnnualMXN: 5270,
		Limits: Limits{ActivePatients: Unlimited, StorageBytes: 50 * gb, TrackingPhotos: true},
		Perks:  Perks{PlatformMark: false, AllHandoutStyles: true, CustomAccent: true},
		Features: []string{
			"Pacientes activos sin tope", "Todo lo del plan Estándar", "50 GB de archivos",
		},
	},
}

var ErrUnknownPlan = errors.New("plan desconocido")

func ByCode(code string) (Plan, error) {
	for _, p := range Catalog {
		if p.Code == code {
			return p, nil
		}
	}
	return Plan{}, ErrUnknownPlan
}

// LimitError: la acción excede lo que incluye el plan actual.
type LimitError struct {
	Code    string // patients | storage | tracking_photos
	Message string
}

func (e *LimitError) Error() string { return e.Message }
