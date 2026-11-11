package auth

import (
	"context"
	"log/slog"
)

// Mailer envía correos transaccionales. El proveedor está pendiente de
// selección (§25.1); mientras tanto LogMailer solo registra el evento.
type Mailer interface {
	SendPasswordReset(ctx context.Context, to, link string) error
	SendPasswordChanged(ctx context.Context, to string) error
	SendInvitation(ctx context.Context, to, link string) error
}

// Delivers indica si el mailer entrega correos de verdad (el de registro no).
func (LogMailer) Delivers() bool { return false }

type LogMailer struct {
	Log *slog.Logger
	// ExposeLinks solo debe ser true en desarrollo: el enlace es una credencial.
	ExposeLinks bool
}

func (m LogMailer) SendPasswordReset(ctx context.Context, to, link string) error {
	attrs := []any{slog.String("event", "password_reset_email")}
	if m.ExposeLinks {
		attrs = append(attrs, slog.String("to", to), slog.String("link", link))
	}
	m.Log.InfoContext(ctx, "mail_stub", attrs...)
	return nil
}

func (m LogMailer) SendPasswordChanged(ctx context.Context, _ string) error {
	m.Log.InfoContext(ctx, "mail_stub", slog.String("event", "password_changed_email"))
	return nil
}

func (m LogMailer) SendInvitation(ctx context.Context, to, link string) error {
	attrs := []any{slog.String("event", "patient_invitation_email")}
	if m.ExposeLinks {
		attrs = append(attrs, slog.String("to", to), slog.String("link", link))
	}
	m.Log.InfoContext(ctx, "mail_stub", attrs...)
	return nil
}
