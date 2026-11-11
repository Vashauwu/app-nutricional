package testsupport

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
)

// Client es un cliente HTTP con cookies que replica a un navegador: guarda la sesión y reenvía la cookie XSRF.
type Client struct {
	T    *testing.T
	Base string
	hc   *http.Client
	u    *url.URL
}

func NewClient(t *testing.T, base string) *Client {
	jar, _ := cookiejar.New(nil)
	u, _ := url.Parse(base)
	return &Client{T: t, Base: base, hc: &http.Client{Jar: jar}, u: u}
}

func (c *Client) xsrf() string {
	for _, ck := range c.hc.Jar.Cookies(c.u) {
		if ck.Name == "XSRF-TOKEN" {
			return ck.Value
		}
	}
	return ""
}

// Do ejecuta la petición y devuelve estado y cuerpo JSON (objeto).
func (c *Client) Do(method, path string, body any) (int, map[string]any) {
	c.T.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.Base+path, rd)
	require.NoError(c.T, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-XSRF-TOKEN", c.xsrf())
	res, err := c.hc.Do(req)
	require.NoError(c.T, err)
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

// Upload envía multipart (campo "file" + campos de texto). Devuelve estado y cuerpo JSON.
func (c *Client) Upload(path, filename string, data []byte, fields map[string]string) (int, map[string]any) {
	c.T.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	fw, err := mw.CreateFormFile("file", filename)
	require.NoError(c.T, err)
	_, _ = fw.Write(data)
	_ = mw.Close()
	req, err := http.NewRequest("POST", c.Base+path, &buf)
	require.NoError(c.T, err)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("X-XSRF-TOKEN", c.xsrf())
	res, err := c.hc.Do(req)
	require.NoError(c.T, err)
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

// GetRaw devuelve estado, tipo de contenido y cuerpo sin interpretar.
func (c *Client) GetRaw(path string) (int, string, []byte) {
	c.T.Helper()
	res, err := c.hc.Get(c.Base + path)
	require.NoError(c.T, err)
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, res.Header.Get("Content-Type"), raw
}

func (c *Client) Login(email, password string) {
	c.T.Helper()
	code, b := c.Do("POST", "/api/v1/auth/login", map[string]string{"email": email, "password": password})
	require.Equal(c.T, 200, code, fmt.Sprint(b))
}

// ErrCode extrae error.code de una respuesta de error.
func ErrCode(b map[string]any) string {
	m, _ := b["error"].(map[string]any)
	s, _ := m["code"].(string)
	return s
}

// ErrFields extrae error.fields de una respuesta 422.
func ErrFields(b map[string]any) map[string]any {
	m, _ := b["error"].(map[string]any)
	f, _ := m["fields"].(map[string]any)
	return f
}
