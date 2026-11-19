package platform

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Contenido de la landing pública (docs/interno/crm-landing.md). Es el mismo modelo que frontend/.../landing.content.ts. El
// servidor valida TODO al guardar y otra vez al publicar: la interfaz solo ayuda, nunca es la barrera.

type LandingAction struct {
	Label string `json:"label"`
	To    string `json:"to"`
	Kind  string `json:"kind,omitempty"` // primary | ghost
}

// LandingItem sirve a todas las listas: features/principles (icon, title, text), steps y intro (title, text) y faq (q, a).
type LandingItem struct {
	Icon  string `json:"icon,omitempty"`
	Title string `json:"title,omitempty"`
	Text  string `json:"text,omitempty"`
	Q     string `json:"q,omitempty"`
	A     string `json:"a,omitempty"`
}

type LandingSection struct {
	Type    string          `json:"type"`
	ID      string          `json:"id"`
	Nav     string          `json:"nav,omitempty"`
	Enabled *bool           `json:"enabled,omitempty"`
	Title   string          `json:"title,omitempty"`
	Text    string          `json:"text,omitempty"`
	Note    string          `json:"note,omitempty"`
	Caption string          `json:"caption,omitempty"`
	Actions []LandingAction `json:"actions,omitempty"` // hero
	Action  *LandingAction  `json:"action,omitempty"`  // cta
	Points  []LandingItem   `json:"points,omitempty"`  // intro
	Items   []LandingItem   `json:"items,omitempty"`   // features, steps, principles, faq
	Bullets []string        `json:"bullets,omitempty"` // preview
}

type LandingMeta struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

type LandingFooterLink struct {
	Label string `json:"label"`
	To    string `json:"to"`
}

type LandingFooter struct {
	Legal string              `json:"legal"`
	Links []LandingFooterLink `json:"links"`
}

type LandingContent struct {
	Meta     LandingMeta      `json:"meta"`
	Sections []LandingSection `json:"sections"`
	Footer   LandingFooter    `json:"footer"`
}

// LandingError es un problema de validación ligado a un campo, para que la pantalla lo marque donde está.
type LandingError struct {
	Path    string `json:"path"` // p. ej. sections[2].items[0].title
	Message string `json:"message"`
}

const (
	maxSections = 20
	maxTitle    = 120
	maxText     = 600
	maxShort    = 200
	maxAnswer   = 800
	maxItemText = 400
	maxItems    = 12
	maxFaq      = 20
	maxBullets  = 10
)

var (
	anchorRe = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	iconRe   = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	// Rutas internas permitidas como destino (lista cerrada: nunca URL externas ni javascript:).
	landingRoutes = map[string]bool{"/ingresar": true, "/registro": true, "/privacidad": true, "/terminos": true, "/inicio": true}
	// Lo que el producto aún no tiene: la misma lista que vigila la prueba de la landing en el frontend.
	forbiddenWords = []string{"$", "mxn", "testimonio", "certificad", "garantía", "gratis", "whatsapp"}
)

var sectionTypes = map[string]bool{"hero": true, "intro": true, "features": true, "steps": true, "preview": true, "principles": true, "faq": true, "cta": true}

type landingValidator struct{ errs []LandingError }

func (v *landingValidator) add(path, format string, a ...any) {
	v.errs = append(v.errs, LandingError{Path: path, Message: fmt.Sprintf(format, a...)})
}

// text valida un texto plano: sin HTML, sin caracteres de control, con tope y sin las palabras vigiladas.
func (v *landingValidator) text(path, s string, max int, required bool) {
	s2 := strings.TrimSpace(s)
	if required && s2 == "" {
		v.add(path, "es obligatorio")
		return
	}
	if utf8.RuneCountInString(s) > max {
		v.add(path, "no puede pasar de %d caracteres", max)
	}
	if strings.ContainsAny(s, "<>") {
		v.add(path, "es texto plano: no uses < ni >")
	}
	for _, r := range s {
		if r < 0x20 && r != '\n' {
			v.add(path, "tiene caracteres no permitidos")
			break
		}
	}
	low := strings.ToLower(s)
	for _, w := range forbiddenWords {
		if strings.Contains(low, w) {
			v.add(path, "no puede decir «%s»: la página solo afirma lo que el producto ya hace (sin precios, testimonios ni certificaciones)", strings.TrimSpace(w))
			break
		}
	}
}

func (v *landingValidator) dest(path, to string, anchors map[string]bool) {
	switch {
	case strings.HasPrefix(to, "#"):
		if !anchors[strings.TrimPrefix(to, "#")] {
			v.add(path, "el destino %q no es una sección activa de la página", to)
		}
	case landingRoutes[to]:
	default:
		v.add(path, "destino no permitido: usa una sección de la página (#id) o /ingresar, /registro, /privacidad, /terminos o /inicio")
	}
}

func (v *landingValidator) action(path string, a LandingAction, anchors map[string]bool) {
	v.text(path+".label", a.Label, 40, true)
	v.dest(path+".to", a.To, anchors)
	if a.Kind != "" && a.Kind != "primary" && a.Kind != "ghost" {
		v.add(path+".kind", "debe ser primary o ghost")
	}
}

func (v *landingValidator) icon(path, ic string, required bool) {
	if ic == "" {
		if required {
			v.add(path, "elige un ícono")
		}
		return
	}
	if len(ic) > 30 || !iconRe.MatchString(ic) {
		v.add(path, "ícono inválido")
	}
}

func (v *landingValidator) list(path string, n, max int) bool {
	if n == 0 {
		v.add(path, "agrega al menos un elemento")
		return false
	}
	if n > max {
		v.add(path, "no puede tener más de %d elementos", max)
		return false
	}
	return true
}

// ValidateLanding devuelve todos los problemas del contenido (vacío = válido).
func ValidateLanding(c LandingContent) []LandingError {
	v := &landingValidator{}
	v.text("meta.title", c.Meta.Title, maxTitle, true)
	v.text("meta.description", c.Meta.Description, 300, true)
	v.text("footer.legal", c.Footer.Legal, maxText, true)
	if len(c.Footer.Links) > 8 {
		v.add("footer.links", "no puede tener más de 8 enlaces")
	}

	if len(c.Sections) == 0 {
		v.add("sections", "agrega al menos la sección principal")
		return v.errs
	}
	if len(c.Sections) > maxSections {
		v.add("sections", "no puede tener más de %d secciones", maxSections)
		return v.errs
	}
	ids, anchors, heroes := map[string]bool{}, map[string]bool{}, 0
	for i, s := range c.Sections {
		p := fmt.Sprintf("sections[%d]", i)
		if !sectionTypes[s.Type] {
			v.add(p+".type", "tipo de sección desconocido")
			continue
		}
		if s.Type == "hero" {
			heroes++
			if i != 0 {
				v.add(p+".type", "la sección principal debe ir primero")
			}
		}
		if len(s.ID) == 0 || len(s.ID) > 40 || !anchorRe.MatchString(s.ID) {
			v.add(p+".id", "usa minúsculas, números y guiones (máx. 40)")
		} else if ids[s.ID] {
			v.add(p+".id", "el id %q está repetido", s.ID)
		}
		ids[s.ID] = true
		if s.Enabled == nil || *s.Enabled {
			anchors[s.ID] = true
		}
	}
	if heroes != 1 {
		v.add("sections", "debe haber exactamente una sección principal (hero)")
	}

	for i, s := range c.Sections {
		if !sectionTypes[s.Type] {
			continue
		}
		p := fmt.Sprintf("sections[%d]", i)
		v.text(p+".nav", s.Nav, 30, false)
		v.text(p+".title", s.Title, maxTitle, s.Type != "preview" || s.Title != "")
		v.text(p+".text", s.Text, maxText, false)
		v.text(p+".note", s.Note, maxShort, false)
		v.text(p+".caption", s.Caption, maxShort, false)
		switch s.Type {
		case "hero":
			if strings.TrimSpace(s.Text) == "" {
				v.add(p+".text", "es obligatorio")
			}
			if len(s.Actions) == 0 || len(s.Actions) > 3 {
				v.add(p+".actions", "el hero lleva de 1 a 3 botones")
			}
			for j, a := range s.Actions {
				v.action(fmt.Sprintf("%s.actions[%d]", p, j), a, anchors)
			}
		case "cta":
			if s.Action == nil {
				v.add(p+".action", "falta el botón")
			} else {
				v.action(p+".action", *s.Action, anchors)
			}
		case "intro":
			if v.list(p+".points", len(s.Points), 6) {
				for j, it := range s.Points {
					q := fmt.Sprintf("%s.points[%d]", p, j)
					v.text(q+".title", it.Title, maxTitle, true)
					v.text(q+".text", it.Text, maxItemText, true)
				}
			}
		case "features", "principles":
			if v.list(p+".items", len(s.Items), maxItems) {
				for j, it := range s.Items {
					q := fmt.Sprintf("%s.items[%d]", p, j)
					v.icon(q+".icon", it.Icon, true)
					v.text(q+".title", it.Title, maxTitle, true)
					v.text(q+".text", it.Text, maxItemText, true)
				}
			}
		case "steps":
			if v.list(p+".items", len(s.Items), 8) {
				for j, it := range s.Items {
					q := fmt.Sprintf("%s.items[%d]", p, j)
					v.text(q+".title", it.Title, maxTitle, true)
					v.text(q+".text", it.Text, maxItemText, true)
				}
			}
		case "faq":
			if v.list(p+".items", len(s.Items), maxFaq) {
				for j, it := range s.Items {
					q := fmt.Sprintf("%s.items[%d]", p, j)
					v.text(q+".q", it.Q, maxShort, true)
					v.text(q+".a", it.A, maxAnswer, true)
				}
			}
		case "preview":
			if len(s.Bullets) > maxBullets {
				v.add(p+".bullets", "no puede tener más de %d viñetas", maxBullets)
			}
			for j, b := range s.Bullets {
				v.text(fmt.Sprintf("%s.bullets[%d]", p, j), b, maxShort, true)
			}
		}
	}
	for j, l := range c.Footer.Links {
		q := fmt.Sprintf("footer.links[%d]", j)
		v.text(q+".label", l.Label, 40, true)
		v.dest(q+".to", l.To, anchors)
	}
	return v.errs
}
