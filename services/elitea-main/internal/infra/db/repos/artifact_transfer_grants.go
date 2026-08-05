package repos

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TransferGrantRow is the domain-shaped view of one
// elitea_storage.transfer_grants row (S15).
type TransferGrantRow struct {
	ID          string
	ProjectID   int64
	BucketID    int64
	Key         string
	Method      string
	ContentType string
	MaxBytes    int64
	DigestAlg   *string
	Digest      []byte
	ExpiresAt   time.Time
	ConsumedAt  *time.Time
	CreatedAt   time.Time
}

// NewTransferGrantInput is the set of caller-supplied fields for
// CreateTransferGrant.
type NewTransferGrantInput struct {
	ID          string
	ProjectID   int64
	BucketID    int64
	Key         string
	Method      string
	ContentType string
	MaxBytes    int64
	DigestAlg   *string
	Digest      []byte
	ExpiresAt   time.Time
}

type artifactTransferGrantQueries interface {
	CreateArtifactTransferGrant(context.Context, sqlcgen.CreateArtifactTransferGrantParams) (sqlcgen.CreateArtifactTransferGrantRow, error)
	GetArtifactTransferGrant(context.Context, sqlcgen.GetArtifactTransferGrantParams) (sqlcgen.GetArtifactTransferGrantRow, error)
	MarkArtifactTransferGrantConsumed(context.Context, string) (int64, error)
}

// ArtifactTransferGrantsRepository is the metadata store for
// elitea_storage.transfer_grants. See docs/plans/storage-migration-plan.md
// S15.
type ArtifactTransferGrantsRepository struct {
	queries artifactTransferGrantQueries
}

func NewArtifactTransferGrantsRepository(pool *pgxpool.Pool) (*ArtifactTransferGrantsRepository, error) {
	if pool == nil {
		return nil, errors.New("artifact transfer grants database is required")
	}
	return newArtifactTransferGrantsRepository(sqlcgen.New(pool))
}

func newArtifactTransferGrantsRepository(queries artifactTransferGrantQueries) (*ArtifactTransferGrantsRepository, error) {
	if queries == nil {
		return nil, errors.New("artifact transfer grants database is required")
	}
	return &ArtifactTransferGrantsRepository{queries: queries}, nil
}

func (r *ArtifactTransferGrantsRepository) CreateTransferGrant(ctx context.Context, input NewTransferGrantInput) (TransferGrantRow, error) {
	expiresAt := input.ExpiresAt
	row, err := r.queries.CreateArtifactTransferGrant(ctx, sqlcgen.CreateArtifactTransferGrantParams{
		ID:          input.ID,
		ProjectID:   input.ProjectID,
		BucketID:    input.BucketID,
		Key:         input.Key,
		Method:      input.Method,
		ContentType: input.ContentType,
		MaxBytes:    input.MaxBytes,
		DigestAlg:   input.DigestAlg,
		Digest:      input.Digest,
		ExpiresAt:   toTimestamptz(&expiresAt),
	})
	if err != nil {
		return TransferGrantRow{}, fmt.Errorf("create artifact transfer grant: %w", err)
	}
	return TransferGrantRow{
		ID: row.ID, ProjectID: row.ProjectID, BucketID: row.BucketID, Key: row.Key,
		Method: row.Method, ContentType: row.ContentType, MaxBytes: row.MaxBytes,
		DigestAlg: row.DigestAlg, Digest: row.Digest,
		ExpiresAt: row.ExpiresAt.Time, ConsumedAt: fromTimestamptz(row.ConsumedAt), CreatedAt: row.CreatedAt.Time,
	}, nil
}

// GetTransferGrant is scoped by projectID — see the wrapped sqlc query's own
// comment for why.
func (r *ArtifactTransferGrantsRepository) GetTransferGrant(ctx context.Context, id string, projectID int64) (TransferGrantRow, error) {
	row, err := r.queries.GetArtifactTransferGrant(ctx, sqlcgen.GetArtifactTransferGrantParams{ID: id, ProjectID: projectID})
	if errors.Is(err, pgx.ErrNoRows) {
		return TransferGrantRow{}, storage.ErrNotFound
	}
	if err != nil {
		return TransferGrantRow{}, fmt.Errorf("get artifact transfer grant: %w", err)
	}
	return TransferGrantRow{
		ID: row.ID, ProjectID: row.ProjectID, BucketID: row.BucketID, Key: row.Key,
		Method: row.Method, ContentType: row.ContentType, MaxBytes: row.MaxBytes,
		DigestAlg: row.DigestAlg, Digest: row.Digest,
		ExpiresAt: row.ExpiresAt.Time, ConsumedAt: fromTimestamptz(row.ConsumedAt), CreatedAt: row.CreatedAt.Time,
	}, nil
}

// MarkTransferGrantConsumed stamps consumed_at, enforcing single-use: a
// grant already consumed (or a nonexistent id) returns
// storage.ErrAlreadyExists — matching the 409 the plan's acceptance
// criteria requires for "a second commit on the same grant." The caller
// (commitTransferGrant) has always already fetched the row by the time it
// calls this, so an id that genuinely does not exist is not a realistic
// path here — see the wrapped sqlc query's own comment.
func (r *ArtifactTransferGrantsRepository) MarkTransferGrantConsumed(ctx context.Context, id string) error {
	rows, err := r.queries.MarkArtifactTransferGrantConsumed(ctx, id)
	if err != nil {
		return fmt.Errorf("mark artifact transfer grant consumed: %w", err)
	}
	if rows == 0 {
		return storage.ErrAlreadyExists
	}
	return nil
}
