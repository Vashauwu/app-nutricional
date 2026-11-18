package plans_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/generated/db"
	"github.com/nutri/app-nutricional/backend/internal/plans"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

func at(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

func TestResolve(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	day := 24 * time.Hour
	cases := []struct {
		name       string
		sub        db.Subscription
		plan       string
		state      string
		downgraded bool
	}{
		{"gratuito", db.Subscription{Plan: "free", Status: "active"}, "free", "free", false},
		{"pagado sin vencimiento (fundadora)", db.Subscription{Plan: "pro", Status: "active", CompReason: pgtype.Text{String: "cuenta fundadora", Valid: true}}, "pro", "active", false},
		{"pagado dentro del periodo", db.Subscription{Plan: "standard", Status: "active", CurrentPeriodEnd: at(now.Add(10 * day))}, "standard", "active", false},
		{"renovación tardía dentro del margen", db.Subscription{Plan: "standard", Status: "active", CurrentPeriodEnd: at(now.Add(-time.Hour))}, "standard", "active", false},
		{"renovación que nunca llegó", db.Subscription{Plan: "standard", Status: "active", CurrentPeriodEnd: at(now.Add(-3 * day))}, "free", "expired", true},
		{"prueba vigente", db.Subscription{Plan: "pro", Status: "trialing", TrialEndsAt: at(now.Add(5 * day))}, "pro", "trialing", false},
		{"prueba terminada", db.Subscription{Plan: "pro", Status: "trialing", TrialEndsAt: at(now.Add(-time.Minute))}, "free", "expired", true},
		{"prueba sin fecha no regala plan", db.Subscription{Plan: "pro", Status: "trialing"}, "free", "expired", true},
		{"cobro fallido en gracia", db.Subscription{Plan: "standard", Status: "past_due", GraceUntil: at(now.Add(3 * day))}, "standard", "past_due", false},
		{"gracia vencida", db.Subscription{Plan: "standard", Status: "past_due", GraceUntil: at(now.Add(-day))}, "free", "expired", true},
		{"cancelada conserva hasta fin del periodo", db.Subscription{Plan: "pro", Status: "canceled", CurrentPeriodEnd: at(now.Add(12 * day))}, "pro", "canceled", false},
		{"cancelada ya terminó", db.Subscription{Plan: "pro", Status: "canceled", CurrentPeriodEnd: at(now.Add(-day))}, "free", "expired", true},
		{"vencida", db.Subscription{Plan: "pro", Status: "expired"}, "free", "expired", true},
		{"estado desconocido no regala plan", db.Subscription{Plan: "pro", Status: "raro"}, "free", "expired", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			st, err := plans.Resolve(c.sub, now)
			require.NoError(t, err)
			require.Equal(t, c.plan, st.Plan.Code)
			require.Equal(t, c.state, st.State)
			require.Equal(t, c.downgraded, st.Downgraded)
			require.Equal(t, c.sub.Plan, st.Contracted.Code, "el plan contratado no cambia")
		})
	}
	_, err := plans.Resolve(db.Subscription{Plan: "otro", Status: "active"}, now)
	require.ErrorIs(t, err, plans.ErrUnknownPlan)
}

// Un plan de pago vencido baja a Gratuito SIN borrar nada: lo existente se conserva y solo se bloquea crear por encima del cupo.
func TestLapsedPlanDowngradesWithoutLosingData(t *testing.T) {
	pool := testsupport.NewPool(t)
	svc := plans.NewService(pool)
	ctx := testsupport.NewPractice(t, pool)
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	svc.SetClock(func() time.Time { return now })

	var uid string
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO users (email, password_hash, display_name, practice_id) VALUES ('v@x.mx','x','V',$1) RETURNING id`, tenant.From(ctx)).Scan(&uid))
	end := now.AddDate(0, 0, 10)
	require.NoError(t, svc.Apply(ctx, plans.Change{Plan: "pro", Period: "monthly", Status: plans.StatusActive, PeriodEnd: &end}))
	for i := 0; i < 20; i++ { // más que el cupo gratuito (15)
		require.NoError(t, svc.CanAddPatient(ctx))
		_, err := pool.Exec(ctx, `INSERT INTO patients (first_name, last_name, birth_date, sex, email, created_by) VALUES ('P','Q','1990-01-01','F',$1,$2)`, fmt.Sprintf("v%d@x.mx", i), uid)
		require.NoError(t, err)
	}
	require.NoError(t, svc.CanUseTrackingPhotos(ctx))

	// Pasa el tiempo: la renovación nunca llegó.
	svc.SetClock(func() time.Time { return now.AddDate(0, 0, 30) })
	st, _, err := svc.Standing(ctx)
	require.NoError(t, err)
	require.Equal(t, "free", st.Plan.Code)
	require.Equal(t, "pro", st.Contracted.Code)
	require.True(t, st.Downgraded)

	var le *plans.LimitError
	require.ErrorAs(t, svc.CanAddPatient(ctx), &le, "con 20 pacientes y plan Gratuito no se puede crear otro")
	require.Equal(t, "patients", le.Code)
	require.ErrorAs(t, svc.CanUseTrackingPhotos(ctx), &le)

	var n int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM patients WHERE created_by = $1`, uid).Scan(&n))
	require.Equal(t, 20, n, "bajar de plan no borra pacientes")
	s, err := svc.Summary(ctx)
	require.NoError(t, err)
	require.Equal(t, 20, s.Usage.ActivePatients, "el uso real se sigue mostrando")
	require.Equal(t, "expired", s.State)

	// Volver a pagar restituye el plan.
	newEnd := now.AddDate(0, 0, 60)
	require.NoError(t, svc.Apply(ctx, plans.Change{Plan: "pro", Period: "monthly", Status: plans.StatusActive, PeriodEnd: &newEnd}))
	require.NoError(t, svc.CanAddPatient(ctx))
}

func TestApplyValidatesDates(t *testing.T) {
	pool := testsupport.NewPool(t)
	svc := plans.NewService(pool)
	ctx := testsupport.NewPractice(t, pool)
	for _, c := range []plans.Change{
		{Plan: "pro", Status: plans.StatusTrialing},
		{Plan: "pro", Status: plans.StatusPastDue},
		{Plan: "pro", Status: plans.StatusCanceled},
		{Plan: "pro", Status: "raro"},
		{Plan: "pro", Period: "semanal"},
	} {
		require.ErrorIs(t, svc.Apply(ctx, c), plans.ErrInvalidChange, "%+v", c)
	}
	soon := time.Now().Add(time.Hour)
	require.NoError(t, svc.Apply(ctx, plans.Change{Plan: "pro", Status: plans.StatusTrialing, TrialEndsAt: &soon}))
}

func TestPerksByPlan(t *testing.T) {
	free, _ := plans.ByCode("free")
	std, _ := plans.ByCode("standard")
	require.True(t, free.Perks.PlatformMark, "el plan gratuito lleva la marca de la plataforma")
	require.False(t, free.Perks.AllHandoutStyles)
	require.False(t, std.Perks.PlatformMark)
	require.True(t, std.Perks.AllHandoutStyles && std.Perks.CustomAccent)
}
