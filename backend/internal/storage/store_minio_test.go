package storage_test

import (
	"context"
	"fmt"
	"io"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/nutri/app-nutricional/backend/internal/storage"
)

// Verifica el cliente S3 contra un MinIO real (mismo protocolo que usa producción). Se omite con -short.
func TestS3StoreAgainstMinIO(t *testing.T) {
	if testing.Short() {
		t.Skip("requiere Docker e imagen de MinIO")
	}
	ctx := context.Background()
	c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "cgr.dev/chainguard/minio:latest",
			Cmd:          []string{"server", "/data"},
			Env:          map[string]string{"MINIO_ROOT_USER": "testkey", "MINIO_ROOT_PASSWORD": "testsecret123"},
			ExposedPorts: []string{"9000/tcp"},
			WaitingFor:   wait.ForHTTP("/minio/health/ready").WithPort("9000/tcp").WithStartupTimeout(90 * time.Second),
		},
		Started: true,
	})
	if err != nil {
		t.Skipf("no se pudo iniciar MinIO: %v", err)
	}
	t.Cleanup(func() { _ = c.Terminate(ctx) })
	host, err := c.Host(ctx)
	require.NoError(t, err)
	port, err := c.MappedPort(ctx, "9000/tcp")
	require.NoError(t, err)

	st, err := storage.NewS3Store(ctx, storage.S3Config{Endpoint: fmt.Sprintf("http://%s:%s", host, port.Port()), Region: "us-east-1",
		AccessKeyID: "testkey", SecretAccessKey: "testsecret123", PrivateBucket: "nutri-private", PublicBucket: "nutri-public"})
	require.NoError(t, err, "crea los buckets si no existen")

	require.NoError(t, st.Put(ctx, "nutri-private", "a/b/c.pdf", []byte("%PDF-1.4 contenido"), "application/pdf"))
	rc, err := st.Get(ctx, "nutri-private", "a/b/c.pdf")
	require.NoError(t, err)
	data, _ := io.ReadAll(rc)
	rc.Close()
	require.Equal(t, "%PDF-1.4 contenido", string(data))

	_, err = st.Get(ctx, "nutri-private", "no-existe")
	require.ErrorIs(t, err, storage.ErrObjectNotFound)
	_, err = st.Get(ctx, "nutri-public", "a/b/c.pdf")
	require.ErrorIs(t, err, storage.ErrObjectNotFound, "los buckets están separados")

	require.NoError(t, st.Delete(ctx, "nutri-private", "a/b/c.pdf"))
	_, err = st.Get(ctx, "nutri-private", "a/b/c.pdf")
	require.ErrorIs(t, err, storage.ErrObjectNotFound)

	// Un segundo arranque con los buckets ya creados no falla.
	_, err = storage.NewS3Store(ctx, storage.S3Config{Endpoint: fmt.Sprintf("http://%s:%s", host, port.Port()), Region: "us-east-1",
		AccessKeyID: "testkey", SecretAccessKey: "testsecret123", PrivateBucket: "nutri-private", PublicBucket: "nutri-public"})
	require.NoError(t, err)
}
