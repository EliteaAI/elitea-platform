package main

import (
	"context"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage/azure"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage/gcs"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage/s3"
)

func TestArtifactNewObjectStoreDispatchesPerBackend(t *testing.T) {
	ctx := context.Background()

	t.Run("s3", func(t *testing.T) {
		store, err := newObjectStore(ctx, storage.Config{
			Backend: "s3",
			S3:      storage.S3Config{Region: "us-east-1", Bucket: "b"},
		})
		if err != nil {
			t.Fatalf("newObjectStore(s3) returned %v, want nil", err)
		}
		if _, ok := store.(*s3.Backend); !ok {
			t.Fatalf("newObjectStore(s3) returned %T, want *s3.Backend", store)
		}
	})

	t.Run("azure", func(t *testing.T) {
		// New() takes the shared-key path (Key set), so this needs no real
		// network reachability — it never dials out at construction time.
		store, err := newObjectStore(ctx, storage.Config{
			Backend: "azure",
			Azure:   storage.AzureConfig{Account: "devstoreaccount1", Key: "a2V5", ContainerName: "b"},
		})
		if err != nil {
			t.Fatalf("newObjectStore(azure) returned %v, want nil", err)
		}
		if _, ok := store.(*azure.Backend); !ok {
			t.Fatalf("newObjectStore(azure) returned %T, want *azure.Backend", store)
		}
	})

	t.Run("gcs", func(t *testing.T) {
		// gcs.New dials for live GCP default credentials at construction
		// time unless Endpoint/WithoutAuthentication is set — S2's support
		// for that landed before S3, which this stage depends on, so this
		// asserts a concrete type rather than tolerating a credential error.
		store, err := newObjectStore(ctx, storage.Config{
			Backend: "gcs",
			GCS:     storage.GCSConfig{Endpoint: "http://127.0.0.1:4443/storage/v1/", Bucket: "b"},
		})
		if err != nil {
			t.Fatalf("newObjectStore(gcs) returned %v, want nil", err)
		}
		if _, ok := store.(*gcs.Backend); !ok {
			t.Fatalf("newObjectStore(gcs) returned %T, want *gcs.Backend", store)
		}
	})

	t.Run("unrecognised backend", func(t *testing.T) {
		if _, err := newObjectStore(ctx, storage.Config{Backend: "filesystem"}); err == nil {
			t.Fatal("newObjectStore(filesystem) returned nil error, want an error")
		}
	})
}
