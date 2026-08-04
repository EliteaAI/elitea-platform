// Package conformance runs one shared table-driven suite against every
// ObjectStore backend the current environment provides a working emulator
// for. Each backend's subtest skips cleanly when its emulator env vars are
// absent, so `go test ./...` is green on a laptop with no containers and
// exhaustive in CI (see deploy/docker-compose.storage-test.yml).
package conformance

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	s3sdk "github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/bloberror"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage/azure"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage/gcs"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage/s3"
)

// conformanceBucket is the single physical bucket/container every backend's
// leg of this suite provisions and operates against. It is unrelated to the
// case-scoped logical bucket names passed to ObjectRef — see runCases.
const conformanceBucket = "elitea-conformance-test"

// conformanceProjectID is a fixed, valid projectID (per S1's
// ^[1-9][0-9]{0,17}$ rule) used to namespace every ref this suite creates.
const conformanceProjectID = "999000001"

func TestArtifactConformance(t *testing.T) {
	cfg := storage.ConfigFromEnv()
	ctx := context.Background()

	t.Run("s3", func(t *testing.T) {
		store := setupS3(t, ctx, cfg)
		runCases(t, store)
	})

	t.Run("azure", func(t *testing.T) {
		store := setupAzure(t, ctx, cfg)
		runCases(t, store)
	})

	t.Run("gcs", func(t *testing.T) {
		store := setupGCS(t, ctx, cfg)
		runCases(t, store)
	})
}

func setupS3(t *testing.T, ctx context.Context, cfg storage.Config) storage.ObjectStore {
	t.Helper()
	if cfg.S3Endpoint == "" {
		t.Skip("S3_ENDPOINT_URL not set; skipping S3 conformance (see deploy/docker-compose.storage-test.yml)")
	}

	region := cfg.S3Region
	if region == "" {
		region = "us-east-1"
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.S3AccessKey, cfg.S3SecretKey, "")),
	)
	if err != nil {
		t.Fatalf("s3 conformance setup: load aws config: %v", err)
	}
	raw := s3sdk.NewFromConfig(awsCfg, func(o *s3sdk.Options) {
		o.BaseEndpoint = aws.String(cfg.S3Endpoint)
		o.UsePathStyle = cfg.S3ForcePathStyle
	})
	if _, err := raw.CreateBucket(ctx, &s3sdk.CreateBucketInput{Bucket: aws.String(conformanceBucket)}); err != nil {
		var alreadyOwned *s3types.BucketAlreadyOwnedByYou
		var alreadyExists *s3types.BucketAlreadyExists
		if !errors.As(err, &alreadyOwned) && !errors.As(err, &alreadyExists) {
			t.Fatalf("s3 conformance setup: create bucket: %v", err)
		}
	}

	backend, err := s3.New(ctx, s3.Config{
		Endpoint:       cfg.S3Endpoint,
		AccessKey:      cfg.S3AccessKey,
		SecretKey:      cfg.S3SecretKey,
		Region:         region,
		ForcePathStyle: cfg.S3ForcePathStyle,
		Bucket:         conformanceBucket,
	})
	if err != nil {
		t.Fatalf("s3.New: %v", err)
	}
	return backend
}

func setupAzure(t *testing.T, ctx context.Context, cfg storage.Config) storage.ObjectStore {
	t.Helper()
	// Azurite (this suite's Azure emulator) is shared-key only — running
	// without a key would fail every operation, not only the Presign case,
	// so the whole leg skips unless all three are set.
	if cfg.AzureEndpoint == "" || cfg.AzureAccount == "" || cfg.AzureKey == "" {
		t.Skip("AZURE_STORAGE_ENDPOINT / AZURE_STORAGE_ACCOUNT / AZURE_STORAGE_KEY not set; skipping Azure conformance")
	}

	cred, err := azblob.NewSharedKeyCredential(cfg.AzureAccount, cfg.AzureKey)
	if err != nil {
		t.Fatalf("azure conformance setup: shared key credential: %v", err)
	}
	rawClient, err := azblob.NewClientWithSharedKeyCredential(cfg.AzureEndpoint, cred, nil)
	if err != nil {
		t.Fatalf("azure conformance setup: raw client: %v", err)
	}
	if _, err := rawClient.CreateContainer(ctx, conformanceBucket, nil); err != nil {
		if !bloberror.HasCode(err, bloberror.ContainerAlreadyExists) {
			t.Fatalf("azure conformance setup: create container: %v", err)
		}
	}

	backend, err := azure.New(ctx, azure.Config{
		Account:       cfg.AzureAccount,
		Key:           cfg.AzureKey,
		ContainerName: conformanceBucket,
		Endpoint:      cfg.AzureEndpoint,
	})
	if err != nil {
		t.Fatalf("azure.New: %v", err)
	}
	return backend
}

func setupGCS(t *testing.T, ctx context.Context, cfg storage.Config) storage.ObjectStore {
	t.Helper()
	if cfg.GCSEndpoint == "" {
		t.Skip("GCS_ENDPOINT not set; skipping GCS conformance")
	}

	// fake-gcs-server (this suite's GCS emulator) implements the standard
	// JSON API's bucket-create endpoint and accepts unauthenticated calls,
	// so a plain HTTP POST is enough to provision the physical bucket —
	// no service-account credentials are needed for this step.
	createURL := fmt.Sprintf("%sb?project=elitea-conformance", cfg.GCSEndpoint)
	resp, err := http.Post(createURL, "application/json",
		strings.NewReader(fmt.Sprintf(`{"name":%q}`, conformanceBucket)))
	if err != nil {
		t.Fatalf("gcs conformance setup: create bucket: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusConflict {
		t.Fatalf("gcs conformance setup: create bucket: unexpected status %d", resp.StatusCode)
	}

	backend, err := gcs.New(ctx, gcs.Config{
		Bucket:   conformanceBucket,
		Endpoint: cfg.GCSEndpoint,
	})
	if err != nil {
		t.Fatalf("gcs.New: %v", err)
	}
	return backend
}
