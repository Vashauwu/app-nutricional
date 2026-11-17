package tenant

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestContextHelpers(t *testing.T) {
	ctx := context.Background()
	require.Equal(t, uuid.Nil, From(ctx))
	require.False(t, IsBypass(ctx))
	id := uuid.New()
	ctx = With(ctx, id)
	require.Equal(t, id, From(ctx))
	require.Equal(t, sessionState{practice: id.String()}, wanted(ctx))
	require.Equal(t, sessionState{practice: id.String(), bypass: "on"}, wanted(Bypass(ctx)))
	require.Equal(t, sessionState{}, wanted(context.Background()), "sin consulta: la sesión queda vacía (la base no deja pasar nada)")
}
