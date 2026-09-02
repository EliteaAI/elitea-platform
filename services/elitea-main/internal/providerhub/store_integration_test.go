package providerhub_test

// The admission plane's writes against a real PostgreSQL with migration 0107
// applied — a fresh database per test, dropped after. Gated on
// ELITEA_TEST_DATABASE_URL, the way the service's other integration tests
// are; without it the test skips loudly.

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhub"
)

func admissionPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	const environment = "ELITEA_TEST_DATABASE_URL"
	databaseURL := os.Getenv(environment)
	if databaseURL == "" {
		t.Skipf("set %s to run the PostgreSQL admission-plane test", environment)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	adminConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	adminConfig.MaxConns = 2
	adminPool, err := pgxpool.NewWithConfig(ctx, adminConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(adminPool.Close)
	databaseName := fmt.Sprintf("elitea_providerhub_it_%d_%d", os.Getpid(), time.Now().UnixNano())
	quoted := pgx.Identifier{databaseName}.Sanitize()
	if _, err := adminPool.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = adminPool.Exec(cleanupCtx, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, databaseName)
		_, _ = adminPool.Exec(cleanupCtx, "DROP DATABASE IF EXISTS "+quoted)
	})
	testConfig := adminConfig.Copy()
	testConfig.ConnConfig.Database = databaseName
	pool, err := pgxpool.NewWithConfig(ctx, testConfig)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	sql, err := os.ReadFile(filepath.Join("..", "..", "migrations", "shared", "0107_provider_admitted_revisions.sql"))
	if err != nil {
		t.Fatalf("read 0107: %v", err)
	}
	if _, err := pool.Exec(ctx, string(sql)); err != nil {
		t.Fatalf("apply 0107: %v", err)
	}
	return pool
}

func TestPresentTellsAMigratedDatabaseFromABareOne(t *testing.T) {
	pool := admissionPool(t)
	ctx := context.Background()
	if !providerhub.Present(ctx, pool) {
		t.Fatal("0107 applied, yet the plane is reported absent")
	}
	if _, err := pool.Exec(ctx, "DROP SCHEMA provider_hub CASCADE"); err != nil {
		t.Fatal(err)
	}
	if providerhub.Present(ctx, pool) {
		t.Fatal("the plane is reported present after its schema was dropped")
	}
}

func TestRegisterFilesOriginManifestAndAnInactiveRevisionOnce(t *testing.T) {
	pool := admissionPool(t)
	ctx := context.Background()
	manifest := []byte(`{"name": "deepwiki", "provided_toolkits": []}`)
	first, err := providerhub.Register(ctx, pool, providerhub.Registration{ProjectID: 1, ProviderID: "deepwiki", Origin: "https://elitea-deepwiki-svc:8443", Manifest: manifest, Actor: "facade:deepwiki"})
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != "inactive" || first.Reason != providerhub.InactiveReason || first.ManifestDigest != providerhub.Digest(manifest) {
		t.Fatalf("%+v", first)
	}
	var publishedAt time.Time
	_ = pool.QueryRow(ctx, `SELECT published_at FROM provider_hub.provider_published_manifest WHERE digest = $1`, first.ManifestDigest).Scan(&publishedAt)
	time.Sleep(20 * time.Millisecond)
	// The same bytes again: one manifest row, one revision row, a refreshed
	// origin — and a corrected origin lands without a new manifest.
	second, err := providerhub.Register(ctx, pool, providerhub.Registration{ProjectID: 1, ProviderID: "deepwiki", Origin: "https://elitea-deepwiki-svc:9443", Manifest: manifest, Actor: "operator@autotest.local"})
	if err != nil || second.RevisionID != first.RevisionID {
		t.Fatalf("%+v %v", second, err)
	}
	// INSERT-ONLY: the manifest row is untouched by a republish, so nothing
	// an admission cites can change under it — not even its timestamp.
	var republishedAt time.Time
	_ = pool.QueryRow(ctx, `SELECT published_at FROM provider_hub.provider_published_manifest WHERE digest = $1`, first.ManifestDigest).Scan(&republishedAt)
	if !republishedAt.Equal(publishedAt) {
		t.Fatalf("the manifest row was rewritten: %s → %s", publishedAt, republishedAt)
	}
	var manifests, revisions int
	var origin, registeredBy string
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM provider_hub.provider_published_manifest`).Scan(&manifests)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM provider_hub.provider_admitted_revision`).Scan(&revisions)
	_ = pool.QueryRow(ctx, `SELECT origin, registered_by FROM provider_hub.provider_origin_registration WHERE project_id = 1 AND provider_id = 'deepwiki'`).Scan(&origin, &registeredBy)
	if manifests != 1 || revisions != 1 || origin != "https://elitea-deepwiki-svc:9443" || registeredBy != "operator@autotest.local" {
		t.Fatalf("manifests=%d revisions=%d origin=%s by=%s", manifests, revisions, origin, registeredBy)
	}
	// A changed manifest is a second manifest and a second revision.
	if _, err := providerhub.Register(ctx, pool, providerhub.Registration{ProjectID: 1, ProviderID: "deepwiki", Origin: origin, Manifest: []byte(`{"name": "deepwiki", "provided_toolkits": [{"name": "Wikis"}]}`), Actor: "facade:deepwiki"}); err != nil {
		t.Fatal(err)
	}
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM provider_hub.provider_published_manifest`).Scan(&manifests)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM provider_hub.provider_admitted_revision`).Scan(&revisions)
	if manifests != 2 || revisions != 2 {
		t.Fatalf("manifests=%d revisions=%d", manifests, revisions)
	}
}

func TestRecordHealthOverwritesTheProjectionAndNeedsARegistration(t *testing.T) {
	pool := admissionPool(t)
	ctx := context.Background()
	if err := providerhub.RecordHealth(ctx, pool, 1, "ghost", true, "never registered"); err == nil {
		t.Fatal("a probe of an unregistered provider wrote a row")
	}
	if _, err := providerhub.Register(ctx, pool, providerhub.Registration{ProjectID: 1, ProviderID: "deepwiki", Origin: "https://p", Manifest: []byte(`{"name":"deepwiki"}`), Actor: "t"}); err != nil {
		t.Fatal(err)
	}
	if err := providerhub.RecordHealth(ctx, pool, 1, "deepwiki", false, "HTTP 503"); err != nil {
		t.Fatal(err)
	}
	if err := providerhub.RecordHealth(ctx, pool, 1, "deepwiki", true, "health UP in 3ms"); err != nil {
		t.Fatal(err)
	}
	var rows int
	var healthy bool
	var detail string
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM provider_hub.provider_health_projection`).Scan(&rows)
	_ = pool.QueryRow(ctx, `SELECT healthy, detail FROM provider_hub.provider_health_projection WHERE project_id = 1 AND provider_id = 'deepwiki'`).Scan(&healthy, &detail)
	if rows != 1 || !healthy || detail != "health UP in 3ms" {
		t.Fatalf("rows=%d healthy=%v detail=%q", rows, healthy, detail)
	}
}
