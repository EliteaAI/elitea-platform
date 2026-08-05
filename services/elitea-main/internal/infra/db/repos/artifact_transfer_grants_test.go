package repos

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestArtifactGrantRepositoryCreatesAndRoundTripsFields(t *testing.T) {
	digestAlg := "sha256"
	digest := []byte{1, 2, 3}
	expiresAt := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	queries := &artifactTransferGrantQueriesStub{
		createRow: sqlcgen.CreateArtifactTransferGrantRow{
			ID: "grant-1", ProjectID: 7, BucketID: 42, Key: "grant-1",
			Method: "PUT", ContentType: "image/png", MaxBytes: 1024,
			DigestAlg: &digestAlg, Digest: digest,
			ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
		},
	}
	repository, err := newArtifactTransferGrantsRepository(queries)
	if err != nil {
		t.Fatal(err)
	}

	row, err := repository.CreateTransferGrant(context.Background(), NewTransferGrantInput{
		ID: "grant-1", ProjectID: 7, BucketID: 42, Key: "grant-1",
		Method: "PUT", ContentType: "image/png", MaxBytes: 1024,
		DigestAlg: &digestAlg, Digest: digest, ExpiresAt: expiresAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if row.ID != "grant-1" || row.ProjectID != 7 || row.BucketID != 42 || row.Method != "PUT" ||
		row.ContentType != "image/png" || row.MaxBytes != 1024 || *row.DigestAlg != "sha256" ||
		string(row.Digest) != string(digest) || !row.ExpiresAt.Equal(expiresAt) || row.ConsumedAt != nil {
		t.Fatalf("row = %+v", row)
	}
	if queries.createArg.ExpiresAt.Time != expiresAt {
		t.Fatalf("create arg expires_at = %v, want %v", queries.createArg.ExpiresAt.Time, expiresAt)
	}
}

func TestArtifactGrantRepositoryGetMapsNoRowsToNotFound(t *testing.T) {
	queries := &artifactTransferGrantQueriesStub{getErr: pgx.ErrNoRows}
	repository, err := newArtifactTransferGrantsRepository(queries)
	if err != nil {
		t.Fatal(err)
	}
	_, err = repository.GetTransferGrant(context.Background(), "missing", 7)
	if !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
}

func TestArtifactGrantRepositoryGetScopesByProjectID(t *testing.T) {
	queries := &artifactTransferGrantQueriesStub{
		getRow: sqlcgen.GetArtifactTransferGrantRow{ID: "grant-1", ProjectID: 7, Method: "PUT"},
	}
	repository, err := newArtifactTransferGrantsRepository(queries)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.GetTransferGrant(context.Background(), "grant-1", 7); err != nil {
		t.Fatal(err)
	}
	if queries.getArg.ID != "grant-1" || queries.getArg.ProjectID != 7 {
		t.Fatalf("get arg = %+v", queries.getArg)
	}
}

func TestArtifactGrantRepositoryGetByIDIsNotScopedByProject(t *testing.T) {
	queries := &artifactTransferGrantQueriesStub{
		getByIDRow: sqlcgen.GetArtifactTransferGrantByIDRow{ID: "grant-1", ProjectID: 7, Method: "PUT"},
	}
	repository, err := newArtifactTransferGrantsRepository(queries)
	if err != nil {
		t.Fatal(err)
	}
	row, err := repository.GetTransferGrantByID(context.Background(), "grant-1")
	if err != nil {
		t.Fatal(err)
	}
	if row.ProjectID != 7 {
		t.Fatalf("row.ProjectID = %d, want 7 — the caller, not the query, is responsible for comparing this against the request's own projectID", row.ProjectID)
	}
	if queries.getByIDArg != "grant-1" {
		t.Fatalf("get-by-id arg = %q, want grant-1", queries.getByIDArg)
	}
}

func TestArtifactGrantRepositoryGetByIDMapsNoRowsToNotFound(t *testing.T) {
	queries := &artifactTransferGrantQueriesStub{getByIDErr: pgx.ErrNoRows}
	repository, err := newArtifactTransferGrantsRepository(queries)
	if err != nil {
		t.Fatal(err)
	}
	_, err = repository.GetTransferGrantByID(context.Background(), "missing")
	if !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
}

// TestArtifactGrantRepositoryMarkConsumedRejectsSecondCallWithAlreadyExists
// proves the plan's "a second commit on the same grant returns 409"
// acceptance criterion at the repository layer: 0 rows affected — whether
// from an already-consumed grant or (in production) one that no longer
// exists — maps to storage.ErrAlreadyExists, which artifacts/grants.go maps
// to 409.
func TestArtifactGrantRepositoryMarkConsumedRejectsSecondCallWithAlreadyExists(t *testing.T) {
	queries := &artifactTransferGrantQueriesStub{markRows: 0}
	repository, err := newArtifactTransferGrantsRepository(queries)
	if err != nil {
		t.Fatal(err)
	}
	err = repository.MarkTransferGrantConsumed(context.Background(), "grant-1")
	if !errors.Is(err, storage.ErrAlreadyExists) {
		t.Fatalf("error = %v, want ErrAlreadyExists", err)
	}
}

func TestArtifactGrantRepositoryMarkConsumedSucceedsOnFirstCall(t *testing.T) {
	queries := &artifactTransferGrantQueriesStub{markRows: 1}
	repository, err := newArtifactTransferGrantsRepository(queries)
	if err != nil {
		t.Fatal(err)
	}
	if err := repository.MarkTransferGrantConsumed(context.Background(), "grant-1"); err != nil {
		t.Fatal(err)
	}
}

type artifactTransferGrantQueriesStub struct {
	createRow sqlcgen.CreateArtifactTransferGrantRow
	createArg sqlcgen.CreateArtifactTransferGrantParams
	createErr error

	getRow sqlcgen.GetArtifactTransferGrantRow
	getArg sqlcgen.GetArtifactTransferGrantParams
	getErr error

	getByIDRow sqlcgen.GetArtifactTransferGrantByIDRow
	getByIDArg string
	getByIDErr error

	markRows int64
	markErr  error
}

func (stub *artifactTransferGrantQueriesStub) CreateArtifactTransferGrant(
	_ context.Context, arg sqlcgen.CreateArtifactTransferGrantParams,
) (sqlcgen.CreateArtifactTransferGrantRow, error) {
	stub.createArg = arg
	return stub.createRow, stub.createErr
}

func (stub *artifactTransferGrantQueriesStub) GetArtifactTransferGrant(
	_ context.Context, arg sqlcgen.GetArtifactTransferGrantParams,
) (sqlcgen.GetArtifactTransferGrantRow, error) {
	stub.getArg = arg
	return stub.getRow, stub.getErr
}

func (stub *artifactTransferGrantQueriesStub) GetArtifactTransferGrantByID(
	_ context.Context, id string,
) (sqlcgen.GetArtifactTransferGrantByIDRow, error) {
	stub.getByIDArg = id
	return stub.getByIDRow, stub.getByIDErr
}

func (stub *artifactTransferGrantQueriesStub) MarkArtifactTransferGrantConsumed(
	_ context.Context, _ string,
) (int64, error) {
	return stub.markRows, stub.markErr
}
