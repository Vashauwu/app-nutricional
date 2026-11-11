package auth

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

// SMTPConfig sirve para cualquier proveedor con SMTP (Resend, Brevo, SES, Mailgun, Gmail con contraseña de aplicación…).
type SMTPConfig struct {
	Host, Username, Password string
	Port                     int
	From                     string // dirección remitente, p. ej. no-responder@tudominio.mx
	FromName                 string // nombre visible, p. ej. el de la consulta
	Timeout                  time.Duration
}

// SMTPMailer envía los correos transaccionales por SMTP. El envío es asíncrono: la respuesta HTTP no depende del
// proveedor y su duración no revela si una cuenta existe (evita enumeración de cuentas). Los fallos se registran.
type SMTPMailer struct {
	cfg SMTPConfig
	log *slog.Logger
	// send se puede sustituir en pruebas.
	send func(cfg SMTPConfig, to string, msg []byte) error
}

func NewSMTPMailer(cfg SMTPConfig, log *slog.Logger) (*SMTPMailer, error) {
	if cfg.Host == "" || cfg.From == "" {
		return nil, errors.New("SMTP_HOST y SMTP_FROM son obligatorios")
	}
	if _, err := mail.ParseAddress(cfg.From); err != nil {
		return nil, fmt.Errorf("SMTP_FROM no es una dirección válida: %w", err)
	}
	if cfg.Port == 0 {
		cfg.Port = 587
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 15 * time.Second
	}
	return &SMTPMailer{cfg: cfg, log: log, send: deliver}, nil
}

// Delivers: el mailer SMTP sí entrega correos.
func (m *SMTPMailer) Delivers() bool { return true }

func (m *SMTPMailer) SendPasswordReset(ctx context.Context, to, link string) error {
	return m.queue(ctx, "password_reset", to, "Restablece tu contraseña",
		"Recibimos una solicitud para restablecer tu contraseña.",
		"Crear una contraseña nueva", link,
		"El enlace vence en 30 minutos y solo funciona una vez. Si no lo solicitaste, ignora este mensaje: tu contraseña no cambia.")
}

func (m *SMTPMailer) SendInvitation(ctx context.Context, to, link string) error {
	return m.queue(ctx, "invitation", to, "Tu acceso a la plataforma de nutrición",
		"Tu nutrióloga te invitó a su plataforma, donde consultarás tu plan alimentario y registrarás tu seguimiento.",
		"Activar mi cuenta", link,
		"El enlace vence en 7 días y solo funciona una vez. Al entrar por primera vez elegirás tu contraseña.")
}

func (m *SMTPMailer) SendPasswordChanged(ctx context.Context, to string) error {
	return m.queue(ctx, "password_changed", to, "Tu contraseña se cambió",
		"Te avisamos que la contraseña de tu cuenta se cambió hace un momento.",
		"", "",
		"Si no fuiste tú, solicita un restablecimiento de contraseña de inmediato y avisa a tu nutrióloga.")
}

func (m *SMTPMailer) queue(_ context.Context, event, to, subject, intro, cta, link, foot string) error {
	addr, err := mail.ParseAddress(to)
	if err != nil || strings.ContainsAny(to, "\r\n") {
		return fmt.Errorf("destinatario inválido")
	}
	msg := m.build(addr.Address, subject, intro, cta, link, foot)
	go func() { // contexto propio: la petición HTTP puede terminar antes
		if err := m.send(m.cfg, addr.Address, msg); err != nil {
			m.log.Error("mail_send_failed", slog.String("event", event), slog.Any("error", err))
			return
		}
		m.log.Info("mail_sent", slog.String("event", event))
	}()
	return nil
}

func (m *SMTPMailer) build(to, subject, intro, cta, link, foot string) []byte {
	name := m.cfg.FromName
	if name == "" {
		name = "Nutrición"
	}
	from := (&mail.Address{Name: name, Address: m.cfg.From}).String()
	boundary := "nutri-" + fmt.Sprint(time.Now().UnixNano())

	text := intro + "\r\n\r\n"
	htmlBody := `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#2b2430">` +
		`<h2 style="color:#514653;margin:0 0 16px">` + html.EscapeString(name) + `</h2>` +
		`<p style="line-height:1.5">` + html.EscapeString(intro) + `</p>`
	if link != "" {
		text += cta + ":\r\n" + link + "\r\n\r\n"
		htmlBody += `<p style="margin:24px 0"><a href="` + html.EscapeString(link) + `" style="background:#514653;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">` +
			html.EscapeString(cta) + `</a></p>` +
			`<p style="font-size:13px;color:#6b6270;word-break:break-all">Si el botón no funciona, copia este enlace en tu navegador:<br>` + html.EscapeString(link) + `</p>`
	}
	text += foot + "\r\n"
	htmlBody += `<p style="font-size:13px;color:#6b6270;line-height:1.5">` + html.EscapeString(foot) + `</p></div>`

	var b strings.Builder
	h := func(k, v string) { b.WriteString(k + ": " + v + "\r\n") }
	h("From", from)
	h("To", to)
	h("Subject", mime.QEncoding.Encode("utf-8", subject))
	h("Date", time.Now().Format(time.RFC1123Z))
	h("MIME-Version", "1.0")
	h("Auto-Submitted", "auto-generated")
	h("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
	b.WriteString("\r\n")
	for _, part := range [][2]string{{"text/plain", text}, {"text/html", htmlBody}} {
		b.WriteString("--" + boundary + "\r\n")
		b.WriteString("Content-Type: " + part[0] + "; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n")
		b.WriteString(part[1] + "\r\n")
	}
	b.WriteString("--" + boundary + "--\r\n")
	return []byte(b.String())
}

// deliver abre la conexión (TLS implícito en 465, STARTTLS si el servidor lo ofrece) y envía el mensaje.
func deliver(cfg SMTPConfig, to string, msg []byte) error {
	addr := net.JoinHostPort(cfg.Host, fmt.Sprint(cfg.Port))
	d := net.Dialer{Timeout: cfg.Timeout}
	var conn net.Conn
	var err error
	tlsCfg := &tls.Config{ServerName: cfg.Host, MinVersion: tls.VersionTLS12}
	if cfg.Port == 465 {
		conn, err = tls.DialWithDialer(&d, "tcp", addr, tlsCfg)
	} else {
		conn, err = d.Dial("tcp", addr)
	}
	if err != nil {
		return err
	}
	_ = conn.SetDeadline(time.Now().Add(cfg.Timeout * 2))
	c, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()
	if cfg.Port != 465 {
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err := c.StartTLS(tlsCfg); err != nil {
				return err
			}
		}
	}
	if cfg.Username != "" {
		// PlainAuth se niega a enviar la clave sin TLS (salvo localhost).
		if err := c.Auth(smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)); err != nil {
			return err
		}
	}
	if err := c.Mail(cfg.From); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}
