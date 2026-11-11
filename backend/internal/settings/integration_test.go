package settings_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/auth"
	"github.com/nutri/app-nutricional/backend/internal/config"
	"github.com/nutri/app-nutricional/backend/internal/middleware"
	"github.com/nutri/app-nutricional/backend/internal/patients"
	"github.com/nutri/app-nutricional/backend/internal/settings"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

type noMail struct{}

func (noMail) SendPasswordReset(context.Context, string, string) error { return nil }
func (noMail) SendPasswordChanged(context.Context, string) error       { return nil }
func (noMail) SendInvitation(context.Context, string, string) error    { return nil }

func TestContrastMatchesWCAG(t *testing.T) {
	require.InDelta(t, 21.0, settings.Contrast("#000000", "#FFFFFF"), 0.01)
	require.InDelta(t, 1.0, settings.Contrast("#FFFFFF", "#FFFFFF"), 0.01)
	require.Greater(t, settings.Contrast("#514653", "#FAF7F2"), 7.0, "el ciruela de la paleta cumple AA con holgura")
	require.Less(t, settings.Contrast("#F4C9D6", "#FAF7F2"), 4.5, "un pastel no sirve como color de texto/botón")
}

func TestSettingsIntegration(t *testing.T) {
	pool := testsupport.NewPool(t)
	cfg := config.Config{JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour, PasswordResetTTL: 30 * time.Minute}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	as := auth.NewService(pool, cfg, noMail{}, log)
	ps := patients.NewService(pool, as, log)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	v1 := r.Group("/api/v1")
	auth.NewController(as, cfg).Register(v1)
	patients.NewController(ps, as, log).Register(v1)
	settings.NewController(settings.NewService(pool, log), as, log).Register(v1)
	srv := httptest.NewServer(r)
	defer srv.Close()
	ctx := context.Background()

	_, err := as.CreateUser(ctx, "nutri@demo.mx", "Lic. Prueba", "nutritionist", "demo1234")
	require.NoError(t, err)
	nutri := testsupport.NewClient(t, srv.URL)
	nutri.Login("nutri@demo.mx", "demo1234")

	t.Run("sin configuración guardada se usan valores por defecto", func(t *testing.T) {
		code, b := nutri.Do("GET", "/api/v1/settings", nil)
		require.Equal(t, 200, code, fmt.Sprint(b))
		require.Equal(t, "America/Mexico_City", b["region"].(map[string]any)["timezone"])
		require.EqualValues(t, 50*1024*1024, b["storage"].(map[string]any)["default_quota_bytes"])
		require.Equal(t, "10", fmt.Sprint(b["alerts"].(map[string]any)["energy_tolerance_pct"]))
		require.NotEmpty(t, b["alerts"].(map[string]any)["clinical_rules"])
	})

	t.Run("marca: valida colores con contraste WCAG y la marca pública no expone contacto", func(t *testing.T) {
		good := map[string]any{"business_name": "Nutrición Integral", "tagline": "Lema", "primary": "#2c5a78", "secondary": "#ddd6f2", "phone": "55 1", "email": "c@x.mx", "address": "Calle 1", "credentials": "Lic.", "license_number": "123"}
		code, b := nutri.Do("PUT", "/api/v1/settings/brand", good)
		require.Equal(t, 200, code, fmt.Sprint(b))

		for name, patch := range map[string]map[string]any{
			"pastel con bajo contraste": {"primary": "#F4C9D6"},
			"no es hexadecimal":         {"primary": "rojo"},
			"sin nombre":                {"business_name": " "},
			"correo inválido":           {"email": "sin-arroba"},
		} {
			body := map[string]any{}
			for k, v := range good {
				body[k] = v
			}
			for k, v := range patch {
				body[k] = v
			}
			code, b := nutri.Do("PUT", "/api/v1/settings/brand", body)
			require.Equal(t, 422, code, name+" "+fmt.Sprint(b))
		}
		code, pub := testsupport.NewClient(t, srv.URL).Do("GET", "/api/v1/public/brand", nil)
		require.Equal(t, 200, code, "visible sin sesión para la pantalla de ingreso")
		require.Equal(t, "Nutrición Integral", pub["business_name"])
		require.NotContains(t, pub, "phone")
		require.NotContains(t, pub, "email")
		require.NotContains(t, pub, "license_number")
	})

	t.Run("región, almacenamiento y alertas validan rangos", func(t *testing.T) {
		code, _ := nutri.Do("PUT", "/api/v1/settings/region", map[string]any{"timezone": "America/Cancun", "week_start": "sun"})
		require.Equal(t, 200, code)
		code, _ = nutri.Do("PUT", "/api/v1/settings/region", map[string]any{"timezone": "Marte/Olimpo", "week_start": "mon"})
		require.Equal(t, 422, code)
		code, _ = nutri.Do("PUT", "/api/v1/settings/region", map[string]any{"timezone": "America/Mexico_City", "week_start": "wed"})
		require.Equal(t, 422, code)

		ok := map[string]any{"default_quota_bytes": 100 * 1024 * 1024, "max_image_bytes": 8 * 1024 * 1024, "max_pdf_bytes": 12 * 1024 * 1024, "warn_threshold_pct": 75}
		code, _ = nutri.Do("PUT", "/api/v1/settings/storage", ok)
		require.Equal(t, 200, code)
		for _, bad := range []map[string]any{
			{"default_quota_bytes": 10, "max_image_bytes": 8 * 1024 * 1024, "max_pdf_bytes": 12 * 1024 * 1024, "warn_threshold_pct": 75},
			{"default_quota_bytes": 100 * 1024 * 1024, "max_image_bytes": 999 * 1024 * 1024, "max_pdf_bytes": 12 * 1024 * 1024, "warn_threshold_pct": 75},
			{"default_quota_bytes": 100 * 1024 * 1024, "max_image_bytes": 8 * 1024 * 1024, "max_pdf_bytes": 12 * 1024 * 1024, "warn_threshold_pct": 0},
		} {
			code, _ = nutri.Do("PUT", "/api/v1/settings/storage", bad)
			require.Equal(t, 422, code)
		}

		alerts := map[string]any{"energy_tolerance_pct": "8", "macro_tolerance_pct": "12", "equivalent_tolerance": "0.5", "clinical_rules": []map[string]any{
			{"keyword": "gastritis", "triggers": []string{"chile", " ", "ch"}, "level": "warning", "message": "Picante con gastritis", "enabled": true}}}
		code, a := nutri.Do("PUT", "/api/v1/settings/alerts", alerts)
		require.Equal(t, 200, code, fmt.Sprint(a))
		rule := a["clinical_rules"].([]any)[0].(map[string]any)
		require.NotEmpty(t, rule["id"], "el servidor asigna el id")
		require.Equal(t, []any{"chile"}, rule["triggers"], "se descartan palabras vacías o de menos de 3 letras")
		code, _ = nutri.Do("PUT", "/api/v1/settings/alerts", map[string]any{"energy_tolerance_pct": "90", "macro_tolerance_pct": "12", "equivalent_tolerance": "1", "clinical_rules": []any{}})
		require.Equal(t, 422, code)
		code, _ = nutri.Do("PUT", "/api/v1/settings/alerts", map[string]any{"energy_tolerance_pct": "8", "macro_tolerance_pct": "12", "equivalent_tolerance": "1",
			"clinical_rules": []map[string]any{{"keyword": "x", "triggers": []string{"abc"}, "level": "gravísimo", "message": "m", "enabled": true}}})
		require.Equal(t, 422, code, "nivel de regla inválido")

		_, all := nutri.Do("GET", "/api/v1/settings", nil)
		require.Equal(t, "America/Cancun", all["region"].(map[string]any)["timezone"], "persistió")
		require.Equal(t, "8", fmt.Sprint(all["alerts"].(map[string]any)["energy_tolerance_pct"]))
	})

	t.Run("documentos legales: cada edición es una versión nueva y obliga a aceptar de nuevo", func(t *testing.T) {
		code, p := nutri.Do("POST", "/api/v1/patients", map[string]any{"first_name": "Pac", "last_name": "Uno", "birth_date": "1990-01-01", "sex": "F", "email": "pac@demo.mx", "goal": "maintenance"})
		require.Equal(t, 201, code)
		pid := p["id"].(string)
		_, cs := nutri.Do("GET", "/api/v1/patients/"+pid+"/consents", nil)
		var ids []string
		for _, d := range cs["pending"].([]any) {
			ids = append(ids, d.(map[string]any)["id"].(string))
		}
		nutri.Do("POST", "/api/v1/patients/"+pid+"/consents/record", map[string]any{"document_ids": ids})
		code, _ = nutri.Do("GET", "/api/v1/patients/"+pid+"/clinical", nil)
		require.Equal(t, 200, code, "con ambos documentos aceptados el expediente está habilitado")

		code, v2 := nutri.Do("POST", "/api/v1/settings/consent-documents", map[string]any{"type": "privacy", "title": "Aviso de privacidad", "content": "Nuevo texto del aviso de privacidad, versión 2."})
		require.Equal(t, 201, code, fmt.Sprint(v2))
		require.EqualValues(t, 2, v2["version"])
		code, _ = nutri.Do("GET", "/api/v1/patients/"+pid+"/clinical", nil)
		require.Equal(t, 423, code, "al publicar una versión nueva, el expediente se restringe hasta aceptarla")

		_, list := nutri.Do("GET", "/api/v1/settings/consent-documents?type=privacy", nil)
		items := list["items"].([]any)
		require.Len(t, items, 2)
		require.Equal(t, true, items[0].(map[string]any)["is_active"])
		require.Equal(t, false, items[1].(map[string]any)["is_active"])
		require.EqualValues(t, 1, items[1].(map[string]any)["acceptances"], "la versión anterior conserva su historial de aceptaciones")

		code, _ = nutri.Do("POST", "/api/v1/settings/consent-documents", map[string]any{"type": "otro", "title": "x", "content": "texto de más de veinte caracteres"})
		require.Equal(t, 422, code)
		code, _ = nutri.Do("POST", "/api/v1/settings/consent-documents", map[string]any{"type": "privacy", "title": "x", "content": "corto"})
		require.Equal(t, 422, code)
	})

	t.Run("solo la nutrióloga cambia la configuración", func(t *testing.T) {
		code, _ := testsupport.NewClient(t, srv.URL).Do("GET", "/api/v1/settings", nil)
		require.Equal(t, 401, code)
		_, err := as.CreateUser(ctx, "pac.login@demo.mx", "Pac", "patient", "demo1234")
		require.NoError(t, err)
		p := testsupport.NewClient(t, srv.URL)
		p.Login("pac.login@demo.mx", "demo1234")
		for _, path := range []string{"/api/v1/settings", "/api/v1/settings/consent-documents?type=privacy"} {
			code, _ := p.Do("GET", path, nil)
			require.Equal(t, 403, code, path)
		}
		code, _ = p.Do("PUT", "/api/v1/settings/brand", map[string]any{"business_name": "Hack", "primary": "#000000", "secondary": "#ffffff"})
		require.Equal(t, 403, code)
		code, b := p.Do("GET", "/api/v1/brand", nil)
		require.Equal(t, 200, code, "la paciente sí puede leer la marca (encabezado y contacto)")
		require.NotEmpty(t, b["business_name"])
		_ = uuid.Nil
	})
}
