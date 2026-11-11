package auth

import (
	"bufio"
	"context"
	"io"
	"log/slog"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// fakeSMTP es un servidor SMTP mínimo sin TLS que captura el mensaje recibido.
func fakeSMTP(t *testing.T) (port int, got chan string) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { l.Close() })
	got = make(chan string, 1)
	go func() {
		c, err := l.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		r := bufio.NewReader(c)
		w := func(s string) { _, _ = io.WriteString(c, s+"\r\n") }
		w("220 fake ESMTP")
		var rcpt string
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			switch cmd := strings.ToUpper(strings.TrimSpace(line)); {
			case strings.HasPrefix(cmd, "EHLO"):
				w("250 fake")
			case strings.HasPrefix(cmd, "MAIL"):
				w("250 ok")
			case strings.HasPrefix(cmd, "RCPT"):
				rcpt = strings.TrimSpace(line)
				w("250 ok")
			case cmd == "DATA":
				w("354 go")
				var b strings.Builder
				for {
					l, _ := r.ReadString('\n')
					if l == ".\r\n" {
						break
					}
					b.WriteString(l)
				}
				w("250 queued")
				got <- rcpt + "\n" + b.String()
			case cmd == "QUIT":
				w("221 bye")
				return
			}
		}
	}()
	return l.Addr().(*net.TCPAddr).Port, got
}

func TestSMTPMailerSendsInvitation(t *testing.T) {
	port, got := fakeSMTP(t)
	m, err := NewSMTPMailer(SMTPConfig{Host: "127.0.0.1", Port: port, From: "no-responder@consulta.mx", FromName: "Nutrición Integral"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	require.NoError(t, err)
	require.NoError(t, m.SendInvitation(context.Background(), "ana@demo.mx", "https://app.test/restablecer/abc123?x=1&y=<2>"))

	select {
	case msg := <-got:
		require.Contains(t, msg, "ana@demo.mx")
		require.Contains(t, msg, "Subject: =?utf-8?q?")
		require.Contains(t, msg, "multipart/alternative")
		require.Contains(t, msg, "https://app.test/restablecer/abc123?x=1&y=<2>", "el texto plano lleva el enlace tal cual")
		require.Contains(t, msg, "x=1&amp;y=&lt;2&gt;", "en HTML el enlace va escapado")
		require.Contains(t, msg, "7 días")
		require.Contains(t, msg, "Nutrición Integral")
	case <-time.After(5 * time.Second):
		t.Fatal("no llegó el correo")
	}
}

func TestSMTPMailerValidation(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	_, err := NewSMTPMailer(SMTPConfig{Host: "", From: "a@b.mx"}, log)
	require.Error(t, err)
	_, err = NewSMTPMailer(SMTPConfig{Host: "h", From: "no-es-correo"}, log)
	require.Error(t, err)
	m, _ := NewSMTPMailer(SMTPConfig{Host: "h", From: "a@b.mx"}, log)
	m.send = func(SMTPConfig, string, []byte) error { t.Error("no debe enviar"); return nil }
	require.Error(t, m.SendPasswordReset(context.Background(), "x@y.mx\r\nBcc: victima@z.mx", "l"), "inyección de cabeceras")
	require.Error(t, m.SendPasswordReset(context.Background(), "sin-arroba", "l"))
}
