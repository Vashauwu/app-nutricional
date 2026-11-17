package plans_test

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/nutri/app-nutricional/backend/internal/plans"
	"github.com/nutri/app-nutricional/backend/internal/tenant"
	"github.com/nutri/app-nutricional/backend/internal/testsupport"
)

func TestFreePlanLimits(t *testing.T) {
	pool := testsupport.NewPool(t)
	svc := plans.NewService(pool)
	ctx := testsupport.NewPractice(t, pool)

	p, sub, err := svc.Current(ctx)
	require.NoError(t, err)
	require.Equal(t, "free", p.Code)
	require.Equal(t, "active", sub.Status)

	var uid string
	require.NoError(t, pool.QueryRow(ctx, `INSERT INTO users (email, password_hash, display_name, practice_id) VALUES ('limite@x.mx','x','L',$1) RETURNING id`, tenant.From(ctx)).Scan(&uid))
	for i := 0; i < 15; i++ {
		require.NoError(t, svc.CanAddPatient(ctx), "con %d pacientes aún cabe uno", i)
		_, err := pool.Exec(ctx, `INSERT INTO patients (first_name, last_name, birth_date, sex, email, created_by) VALUES ('P','Q','1990-01-01','F',$1,$2)`, fmt.Sprintf("p%d@x.mx", i), uid)
		require.NoError(t, err)
	}
	var le *plans.LimitError
	require.ErrorAs(t, svc.CanAddPatient(ctx), &le)
	require.Equal(t, "patients", le.Code)

	// Archivar libera lugar.
	_, err = pool.Exec(ctx, `UPDATE patients SET status = 'inactive' WHERE email = 'p0@x.mx'`)
	require.NoError(t, err)
	require.NoError(t, svc.CanAddPatient(ctx))

	// Espacio y fotografías de seguimiento.
	require.NoError(t, svc.CanStore(ctx, 1<<20))
	require.ErrorAs(t, svc.CanStore(ctx, 301<<20), &le)
	require.Equal(t, "storage", le.Code)
	require.ErrorAs(t, svc.CanUseTrackingPhotos(ctx), &le)
	require.Equal(t, "tracking_photos", le.Code)

	// Otro plan: sin esos topes.
	require.NoError(t, svc.SetPlan(ctx, "pro", "annual"))
	require.NoError(t, svc.CanStore(ctx, 301<<20))
	require.NoError(t, svc.CanUseTrackingPhotos(ctx))
	require.ErrorIs(t, svc.SetPlan(ctx, "inexistente", ""), plans.ErrUnknownPlan)
}

func TestPlanIsPerPractice(t *testing.T) {
	pool := testsupport.NewPool(t)
	svc := plans.NewService(pool)
	a, b := testsupport.NewPractice(t, pool), testsupport.NewPractice(t, pool)
	require.NoError(t, svc.SetPlan(a, "standard", "monthly"))
	pa, _, err := svc.Current(a)
	require.NoError(t, err)
	pb, _, err := svc.Current(b)
	require.NoError(t, err)
	require.Equal(t, "standard", pa.Code)
	require.Equal(t, "free", pb.Code, "cambiar el plan de una consulta no toca el de otra")
}
