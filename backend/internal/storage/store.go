// Package storage guarda archivos en un almacenamiento de objetos compatible con S3 (MinIO, R2, S3) y aplica
// las reglas de validación, cuotas y autorización de descarga (MVP_SPEC §3.3, §4.2, §18).
package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

var ErrObjectNotFound = errors.New("objeto no encontrado")

// ObjectStore abstrae el almacenamiento. Los buckets son dos: uno privado y uno para recursos públicos controlados.
type ObjectStore interface {
	Put(ctx context.Context, bucket, key string, data []byte, contentType string) error
	Get(ctx context.Context, bucket, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, bucket, key string) error
}

// ---------- S3 / MinIO ----------
type S3Config struct {
	Endpoint, Region, AccessKeyID, SecretAccessKey string
	PrivateBucket, PublicBucket                    string
}

type S3Store struct{ c *s3.Client }

func NewS3Store(ctx context.Context, cfg S3Config) (*S3Store, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, "")))
	if err != nil {
		return nil, err
	}
	c := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		if cfg.Endpoint != "" {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
		}
		o.UsePathStyle = true // MinIO
	})
	st := &S3Store{c: c}
	for _, b := range []string{cfg.PrivateBucket, cfg.PublicBucket} {
		if err := st.ensureBucket(ctx, b); err != nil {
			return nil, fmt.Errorf("bucket %q: %w", b, err)
		}
	}
	return st, nil
}

func (s *S3Store) ensureBucket(ctx context.Context, name string) error {
	if _, err := s.c.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(name)}); err == nil {
		return nil
	}
	_, err := s.c.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(name)})
	var owned *types.BucketAlreadyOwnedByYou
	if err != nil && !errors.As(err, &owned) {
		return err
	}
	return nil
}

func (s *S3Store) Put(ctx context.Context, bucket, key string, data []byte, contentType string) error {
	_, err := s.c.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(bucket), Key: aws.String(key), Body: bytes.NewReader(data), ContentType: aws.String(contentType)})
	return err
}

func (s *S3Store) Get(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	out, err := s.c.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		var nf *types.NoSuchKey
		if errors.As(err, &nf) {
			return nil, ErrObjectNotFound
		}
		return nil, err
	}
	return out.Body, nil
}

func (s *S3Store) Delete(ctx context.Context, bucket, key string) error {
	_, err := s.c.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	return err
}

// ---------- Memoria (pruebas) ----------
type MemoryStore struct {
	mu sync.Mutex
	m  map[string][]byte
}

func NewMemoryStore() *MemoryStore { return &MemoryStore{m: map[string][]byte{}} }

func (s *MemoryStore) Put(_ context.Context, bucket, key string, data []byte, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[bucket+"/"+key] = append([]byte(nil), data...)
	return nil
}

func (s *MemoryStore) Get(_ context.Context, bucket, key string) (io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.m[bucket+"/"+key]
	if !ok {
		return nil, ErrObjectNotFound
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}

func (s *MemoryStore) Delete(_ context.Context, bucket, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, bucket+"/"+key)
	return nil
}

// Keys devuelve las claves guardadas (para verificar en pruebas que no se exponen rutas).
func (s *MemoryStore) Keys() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.m))
	for k := range s.m {
		out = append(out, k)
	}
	return out
}
