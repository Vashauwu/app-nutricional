package storage_test

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
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
	"github.com/nutri/app-nutricional/backend/internal/storage"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

type noMail struct{}

func (noMail) SendPasswordReset(context.Context, string, string) error { return nil }
func (noMail) SendPasswordChanged(context.Context, string) error       { return nil }
func (noMail) SendInvitation(context.Context, string, string) error    { return nil }

func pngBytes(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 120, 255})
		}
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

func noisePNG(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	seed := uint32(12345)
	for i := range img.Pix {
		seed = seed*1664525 + 1013904223
		img.Pix[i] = uint8(seed >> 24)
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

const goodPDF = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"

func TestStorageIntegration(t *testing.T) {
	pool := testsupport.NewPool(t)
	cfg := config.Config{JWTSecret: "secreto-de-integracion-suficientemente-largo", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: 720 * time.Hour, PasswordResetTTL: 30 * time.Minute}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	as := auth.NewService(pool, cfg, noMail{}, log)
	ps := patients.NewService(pool, as, log)
	set := settings.NewService(pool, log)
	mem := storage.NewMemoryStore()
	svc := storage.NewService(pool, mem, set, ps, "priv", "pub", log)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())
	v1 := r.Group("/api/v1")
	auth.NewController(as, cfg).Register(v1)
	patients.NewController(ps, as, log).Register(v1)
	settings.NewController(set, as, log).Register(v1)
	storage.NewController(svc, as, func(c *gin.Context, uid uuid.UUID) (uuid.UUID, error) {
		p, err := ps.ForUser(c.Request.Context(), uid)
		return p.ID, err
	}, 20<<20, log).Register(v1)
	srv := httptest.NewServer(r)
	defer srv.Close()
	ctx := context.Background()

	_, err := as.CreateUser(ctx, "nutri@demo.mx", "Lic.", "nutritionist", "demo1234")
	require.NoError(t, err)
	nutri := testsupport.NewClient(t, srv.URL)
	nutri.Login("nutri@demo.mx", "demo1234")

	newPatient := func(email string, consent bool) string {
		code, p := nutri.Do("POST", "/api/v1/patients", map[string]any{"first_name": "Pac", "last_name": email, "birth_date": "1990-01-01", "sex": "F", "email": email, "goal": "maintenance"})
		require.Equal(t, 201, code, fmt.Sprint(p))
		id := p["id"].(string)
		if consent {
			_, cs := nutri.Do("GET", "/api/v1/patients/"+id+"/consents", nil)
			var ids []string
			for _, d := range cs["pending"].([]any) {
				ids = append(ids, d.(map[string]any)["id"].(string))
			}
			code, _ = nutri.Do("POST", "/api/v1/patients/"+id+"/consents/record", map[string]any{"document_ids": ids})
			require.Equal(t, 204, code)
		}
		return id
	}
	link := func(pid, email string) *testsupport.Client {
		uid, err := as.CreateUser(ctx, email, "Paciente", "patient", "demo1234")
		require.NoError(t, err)
		_, err = pool.Exec(ctx, `UPDATE patients SET user_id=$1 WHERE id=$2`, uid, pid)
		require.NoError(t, err)
		c := testsupport.NewClient(t, srv.URL)
		c.Login(email, "demo1234")
		return c
	}
	docFields := func(visible bool) map[string]string {
		return map[string]string{"name": "Biometría", "category": "laboratorio", "document_date": "2026-01-15", "visible_to_patient": fmt.Sprint(visible)}
	}

	pa := newPatient("ana@demo.mx", true)
	pb := newPatient("bea@demo.mx", true)
	ana := link(pa, "ana.login@demo.mx")
	bea := link(pb, "bea.login@demo.mx")

	t.Run("imagen: se reduce a 1920×1080, genera miniatura y se sirve solo con sesión", func(t *testing.T) {
		code, f := nutri.Upload("/api/v1/uploads/images", "plato.png", pngBytes(2400, 1600), map[string]string{"kind": "dish_image"})
		require.Equal(t, 201, code, fmt.Sprint(f))
		require.EqualValues(t, 1620, f["width"], "2400×1600 encaja en 1920×1080 → 1620×1080")
		require.EqualValues(t, 1080, f["height"])
		require.Equal(t, "image/jpeg", f["mime_type"])
		require.NotEmpty(t, f["thumb_url"])
		for _, k := range mem.Keys() {
			require.NotContains(t, k, "plato", "la clave física no depende del nombre del usuario")
		}
		status, ct, body := nutri.GetRaw(f["url"].(string))
		require.Equal(t, 200, status)
		require.Equal(t, "image/jpeg", ct)
		require.Greater(t, len(body), 100)
		status, _, _ = testsupport.NewClient(t, srv.URL).GetRaw(f["url"].(string))
		require.Equal(t, 401, status, "sin sesión no se sirve")
	})

	t.Run("imagen: rechaza corruptas, formatos falsos y HEIC", func(t *testing.T) {
		for name, data := range map[string][]byte{
			"texto disfrazado": []byte("esto no es una imagen"),
			"png truncado":     pngBytes(100, 100)[:60],
			"ejecutable":       append([]byte("MZ"), bytes.Repeat([]byte{0}, 200)...),
		} {
			code, b := nutri.Upload("/api/v1/uploads/images", "x.png", data, map[string]string{"kind": "dish_image"})
			require.Equal(t, 422, code, name+" "+fmt.Sprint(b))
			require.NotEmpty(t, testsupport.ErrFields(b)["file"], name)
		}
		heic := append([]byte{0, 0, 0, 24}, []byte("ftypheic")...)
		heic = append(heic, bytes.Repeat([]byte{0}, 40)...)
		code, b := nutri.Upload("/api/v1/uploads/images", "x.heic", heic, map[string]string{"kind": "dish_image"})
		require.Equal(t, 422, code)
		require.Contains(t, fmt.Sprint(testsupport.ErrFields(b)["file"]), "HEIC")
		code, _ = nutri.Upload("/api/v1/uploads/images", "x.png", pngBytes(50, 50), map[string]string{"kind": "otro"})
		require.Equal(t, 422, code)
	})

	t.Run("PDF: valida firma real, integridad y elementos activos", func(t *testing.T) {
		for name, data := range map[string]string{
			"no es pdf":          "hola mundo",
			"incompleto":         "%PDF-1.4\n1 0 obj",
			"con javascript":     "%PDF-1.4\n<< /JavaScript (app.alert(1)) >>\n%%EOF",
			"archivo incrustado": "%PDF-1.4\n<< /EmbeddedFile >>\n%%EOF",
		} {
			code, b := nutri.Upload("/api/v1/patients/"+pa+"/documents", "a.pdf", []byte(data), docFields(true))
			require.Equal(t, 422, code, name+" "+fmt.Sprint(b))
		}
		code, _ := nutri.Upload("/api/v1/patients/"+pa+"/documents", "a.pdf", []byte(goodPDF), map[string]string{"name": "", "category": "x", "document_date": "2026-01-15"})
		require.Equal(t, 422, code, "metadatos inválidos")
	})

	t.Run("documentos: visibilidad, aislamiento entre pacientes y borrado lógico", func(t *testing.T) {
		code, vis := nutri.Upload("/api/v1/patients/"+pa+"/documents", "lab.pdf", []byte(goodPDF), docFields(true))
		require.Equal(t, 201, code, fmt.Sprint(vis))
		code, hid := nutri.Upload("/api/v1/patients/"+pa+"/documents", "priv.pdf", []byte(goodPDF), docFields(false))
		require.Equal(t, 201, code)

		_, l := nutri.Do("GET", "/api/v1/patients/"+pa+"/documents", nil)
		require.Len(t, l["items"], 2)
		_, mine := ana.Do("GET", "/api/v1/me/documents", nil)
		require.Len(t, mine["items"], 1, "la paciente solo ve los marcados como visibles")

		status, ct, body := ana.GetRaw(vis["url"].(string))
		require.Equal(t, 200, status)
		require.Equal(t, "application/pdf", ct)
		require.True(t, strings.HasPrefix(string(body), "%PDF-"))
		status, _, _ = ana.GetRaw(hid["url"].(string))
		require.Equal(t, 404, status, "documento no visible: se responde como inexistente")
		status, _, _ = bea.GetRaw(vis["url"].(string))
		require.Equal(t, 404, status, "otra paciente no accede")
		status, _, _ = nutri.GetRaw(hid["url"].(string))
		require.Equal(t, 200, status)

		code, _ = ana.Upload("/api/v1/patients/"+pa+"/documents", "x.pdf", []byte(goodPDF), docFields(true))
		require.Equal(t, 403, code, "la paciente no sube al expediente")

		code, up := nutri.Do("PUT", "/api/v1/patients/"+pa+"/documents/"+hid["id"].(string), map[string]any{"name": "Estudio", "category": "estudio", "description": "", "document_date": "2026-02-01", "visible_to_patient": true})
		require.Equal(t, 200, code, fmt.Sprint(up))
		_, mine = ana.Do("GET", "/api/v1/me/documents", nil)
		require.Len(t, mine["items"], 2)

		code, _ = nutri.Do("DELETE", "/api/v1/patients/"+pa+"/documents/"+vis["id"].(string), nil)
		require.Equal(t, 204, code)
		status, _, _ = ana.GetRaw(vis["url"].(string))
		require.Equal(t, 404, status, "tras borrar deja de servirse")
		code, _ = nutri.Do("DELETE", "/api/v1/patients/"+pb+"/documents/"+hid["id"].(string), nil)
		require.Equal(t, 404, code, "no se puede borrar por otro paciente")
	})

	t.Run("documentos requieren consentimientos completos", func(t *testing.T) {
		pc := newPatient("carla@demo.mx", false)
		code, b := nutri.Upload("/api/v1/patients/"+pc+"/documents", "a.pdf", []byte(goodPDF), docFields(true))
		require.Equal(t, 423, code, fmt.Sprint(b))
		require.Equal(t, "consent_pending", testsupport.ErrCode(b))
		carla := link(pc, "carla.login@demo.mx")
		code, _ = carla.Do("GET", "/api/v1/me/documents", nil)
		require.Equal(t, 423, code)
	})

	t.Run("cuota por paciente y tamaño máximo", func(t *testing.T) {
		pq := newPatient("quota@demo.mx", true)
		_, err := pool.Exec(ctx, `UPDATE patients SET quota_override_bytes=$1 WHERE id=$2`, 3000, pq)
		require.NoError(t, err)
		big := goodPDF + strings.Repeat(" ", 2400)
		big = strings.Replace(big, "%%EOF\n", "", 1) + "%%EOF\n"
		code, _ := nutri.Upload("/api/v1/patients/"+pq+"/documents", "1.pdf", []byte(big), docFields(true))
		require.Equal(t, 201, code)
		code, b := nutri.Upload("/api/v1/patients/"+pq+"/documents", "2.pdf", []byte(big), docFields(true))
		require.Equal(t, 507, code, fmt.Sprint(b))
		require.Equal(t, "quota_exceeded", testsupport.ErrCode(b))
		code, u := nutri.Do("GET", "/api/v1/patients/"+pq+"/storage", nil)
		require.Equal(t, 200, code)
		require.EqualValues(t, 3000, u["quota_bytes"])
		require.Greater(t, u["used_bytes"], float64(2400))
		require.Equal(t, true, u["warn"])

		// Tamaño máximo configurable por la nutrióloga.
		code, _ = nutri.Do("PUT", "/api/v1/settings/storage", map[string]any{"default_quota_bytes": 100 << 20, "max_image_bytes": 100 * 1024, "max_pdf_bytes": 1 << 20, "warn_threshold_pct": 80})
		require.Equal(t, 200, code)
		code, b = nutri.Upload("/api/v1/uploads/images", "g.png", noisePNG(900, 900), map[string]string{"kind": "dish_image"})
		require.Equal(t, 413, code, fmt.Sprint(b))
	})
}
