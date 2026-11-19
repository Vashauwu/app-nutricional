package platform_test

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/platform"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

// bundled es el contenido que hoy trae la landing empaquetada (exportado de landing.content.ts).
func bundled(t *testing.T) platform.LandingContent {
	t.Helper()
	raw, err := os.ReadFile("testdata/landing_bundled.json")
	require.NoError(t, err)
	var c platform.LandingContent
	require.NoError(t, json.Unmarshal(raw, &c))
	return c
}

func paths(errs []platform.LandingError) string {
	var p []string
	for _, e := range errs {
		p = append(p, e.Path)
	}
	return strings.Join(p, ",")
}

func TestLandingValidation(t *testing.T) {
	require.Empty(t, platform.ValidateLanding(bundled(t)), "el contenido actual de la página debe ser válido")

	bad := func(name string, mutate func(c *platform.LandingContent), wantPath string) {
		t.Run(name, func(t *testing.T) {
			c := bundled(t)
			mutate(&c)
			errs := platform.ValidateLanding(c)
			require.NotEmpty(t, errs)
			require.Contains(t, paths(errs), wantPath)
		})
	}
	bad("hero no es el primero", func(c *platform.LandingContent) { c.Sections[0], c.Sections[1] = c.Sections[1], c.Sections[0] }, "sections[1].type")
	bad("dos héroes", func(c *platform.LandingContent) { c.Sections[1].Type = "hero" }, "sections")
	bad("id repetido", func(c *platform.LandingContent) { c.Sections[2].ID = c.Sections[1].ID }, "sections[2].id")
	bad("id con mayúsculas", func(c *platform.LandingContent) { c.Sections[1].ID = "Por Que" }, "sections[1].id")
	bad("tipo desconocido", func(c *platform.LandingContent) { c.Sections[1].Type = "video" }, "sections[1].type")
	bad("URL externa", func(c *platform.LandingContent) { c.Sections[0].Actions[0].To = "https://malo.example" }, "sections[0].actions[0].to")
	bad("javascript:", func(c *platform.LandingContent) { c.Sections[0].Actions[0].To = "javascript:alert(1)" }, "sections[0].actions[0].to")
	bad("ancla a sección inexistente", func(c *platform.LandingContent) { c.Sections[0].Actions[1].To = "#no-existe" }, "sections[0].actions[1].to")
	bad("ancla a sección oculta", func(c *platform.LandingContent) {
		off := false
		for i := range c.Sections {
			if c.Sections[i].ID == "como-funciona" {
				c.Sections[i].Enabled = &off
			}
		}
	}, "actions")
	bad("HTML en un texto", func(c *platform.LandingContent) { c.Sections[0].Title = "Hola <script>alert(1)</script>" }, "sections[0].title")
	bad("precio inventado", func(c *platform.LandingContent) { c.Sections[1].Text = "Desde $299 al mes" }, "sections[1].text")
	bad("testimonio inventado", func(c *platform.LandingContent) { c.Sections[1].Text = "Un testimonio de una nutrióloga" }, "sections[1].text")
	bad("texto demasiado largo", func(c *platform.LandingContent) { c.Sections[1].Text = strings.Repeat("a", 601) }, "sections[1].text")
	bad("sin título de página", func(c *platform.LandingContent) { c.Meta.Title = " " }, "meta.title")
	bad("enlace de pie externo", func(c *platform.LandingContent) { c.Footer.Links[0].To = "http://x.example" }, "footer.links[0].to")
	bad("ícono inválido", func(c *platform.LandingContent) {
		for i := range c.Sections {
			if c.Sections[i].Type == "features" {
				c.Sections[i].Items[0].Icon = "../../etc"
			}
		}
	}, ".icon")
}

func TestLandingLifecycleWithFourEyes(t *testing.T) {
	e := start(t, false)
	owner := e.staff(t, "dueno@plataforma.mx")
	content, _ := e.join(t, owner, "contenido@plataforma.mx", "Contenido", platform.RoleContent)
	viewer, _ := e.join(t, owner, "lector@plataforma.mx", "Lector", platform.RoleViewer)
	oc := testsupport.NewClient(t, e.srv.URL)
	oc.Login("dueno@plataforma.mx", "demo1234")
	anon := testsupport.NewClient(t, e.srv.URL)
	bg := context.Background()
	c := bundled(t)

	// Sin nada publicado, el público recibe 404 (la página usa su contenido de respaldo).
	code, _ := anon.Do("GET", "/api/v1/public/landing", nil)
	require.Equal(t, 404, code)

	// Permisos: lector no ve ni edita; contenido edita pero no aprueba.
	code, _ = viewer.Do("GET", "/api/v1/platform/landing", nil)
	require.Equal(t, 403, code)
	code, _ = viewer.Do("PUT", "/api/v1/platform/landing/draft", c)
	require.Equal(t, 403, code)
	code, body := content.Do("PUT", "/api/v1/platform/landing/draft", c)
	require.Equal(t, 200, code, body)
	code, _ = content.Do("POST", "/api/v1/platform/landing/decision", map[string]any{"approve": true})
	require.Equal(t, 403, code, "quien edita no aprueba")

	// Contenido inválido: 422 con los problemas por campo y no se guarda.
	broken := bundled(t)
	broken.Sections[0].Actions[0].To = "https://malo.example"
	code, body = content.Do("PUT", "/api/v1/platform/landing/draft", broken)
	require.Equal(t, 422, code)
	fields := body["error"].(map[string]any)["fields"].(map[string]any)
	require.Contains(t, fields, "sections[0].actions[0].to")

	// Pedir publicar exige motivo; mientras está pendiente no se edita.
	code, _ = content.Do("POST", "/api/v1/platform/landing/request", map[string]string{"reason": "corto"})
	require.Equal(t, 422, code)
	code, body = content.Do("POST", "/api/v1/platform/landing/request", map[string]string{"reason": "Primera publicación desde el CRM"})
	require.Equal(t, 200, code, body)
	require.Equal(t, "pending", body["status"])
	code, _ = content.Do("PUT", "/api/v1/platform/landing/draft", c)
	require.Equal(t, 409, code)
	code, _ = anon.Do("GET", "/api/v1/public/landing", nil)
	require.Equal(t, 404, code, "pedir no publica")

	// Otra persona (el dueño) aprueba: se publica y el público la ve, con ETag por versión.
	_, err := e.svc.DecideLanding(bg, platform.Actor{ID: owner.ID, Email: owner.Email}, true, "")
	require.NoError(t, err, "el dueño no pidió: puede aprobar")
	code, body = anon.Do("GET", "/api/v1/public/landing", nil)
	require.Equal(t, 200, code)
	require.EqualValues(t, 1, body["version"])
	res, err := http.Get(e.srv.URL + "/api/v1/public/landing")
	require.NoError(t, err)
	etag := res.Header.Get("ETag")
	_ = res.Body.Close()
	require.Equal(t, `"landing-1"`, etag)
	req, _ := http.NewRequest("GET", e.srv.URL+"/api/v1/public/landing", nil)
	req.Header.Set("If-None-Match", etag)
	res, err = http.DefaultClient.Do(req)
	require.NoError(t, err)
	_ = res.Body.Close()
	require.Equal(t, 304, res.StatusCode)

	// Segunda versión: el dueño edita Y pide; no puede aprobar lo suyo; otra persona con permiso sí decide.
	c2 := bundled(t)
	c2.Meta.Title = "Nutrición Integral · título nuevo"
	code, body = oc.Do("PUT", "/api/v1/platform/landing/draft", c2)
	require.Equal(t, 200, code, body)
	require.EqualValues(t, 1, body["base_number"])
	code, _ = oc.Do("POST", "/api/v1/platform/landing/request", map[string]string{"reason": "Cambio de título de la página"})
	require.Equal(t, 200, code)
	code, body = oc.Do("POST", "/api/v1/platform/landing/decision", map[string]any{"approve": true})
	require.Equal(t, 403, code, "autoaprobación")
	require.Equal(t, "self_approval", testsupport.ErrCode(body))
	second := e.staff(t, "segundo@plataforma.mx")
	sc := testsupport.NewClient(t, e.srv.URL)
	sc.Login("segundo@plataforma.mx", "demo1234")
	code, body = sc.Do("POST", "/api/v1/platform/landing/decision", map[string]any{"approve": false, "note": "Prefiero el título anterior"})
	require.Equal(t, 200, code, body)
	draft := body["draft"].(map[string]any)
	require.Equal(t, "draft", draft["status"], "rechazar devuelve el texto a borrador")
	require.Equal(t, "Prefiero el título anterior", draft["decision_note"])

	// Retirar lo propio; restaurar la versión 1; publicar la restauración con otra persona.
	code, _ = oc.Do("POST", "/api/v1/platform/landing/request", map[string]string{"reason": "Segundo intento del título"})
	require.Equal(t, 200, code)
	code, _ = sc.Do("POST", "/api/v1/platform/landing/withdraw", nil)
	require.Equal(t, 422, code, "solo quien pidió la retira")
	code, _ = oc.Do("POST", "/api/v1/platform/landing/withdraw", nil)
	require.Equal(t, 200, code)
	code, body = oc.Do("POST", "/api/v1/platform/landing/versions/1/restore", nil)
	require.Equal(t, 200, code, body)
	code, _ = oc.Do("POST", "/api/v1/platform/landing/request", map[string]string{"reason": "Volver a la versión uno"})
	require.Equal(t, 200, code)
	st, err := e.svc.DecideLanding(bg, platform.Actor{ID: second.ID, Email: second.Email}, true, "")
	require.NoError(t, err)
	require.EqualValues(t, 2, *st.Published.Number)
	require.Nil(t, st.Draft)

	code, body = oc.Do("GET", "/api/v1/platform/landing/versions", nil)
	require.Equal(t, 200, code)
	require.Len(t, body["items"], 2)
	code, _ = oc.Do("GET", "/api/v1/platform/landing/versions/99", nil)
	require.Equal(t, 404, code)

	// Todo quedó en la bitácora global.
	act, err := e.svc.Activity(bg, platform.ActivityQuery{Search: "landing", Until: time.Now().Add(time.Hour)})
	require.NoError(t, err)
	require.GreaterOrEqual(t, act.Total, int64(6))
}
