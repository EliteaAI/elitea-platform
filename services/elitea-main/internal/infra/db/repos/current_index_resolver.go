package repos

import (
	"context"
	"errors"
	"fmt"
	"math"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CurrentIndexResolverRepository reads the current platform's tenant-local
// toolkit and configuration tables. The project ID selects the transaction
// search_path; it is never interpolated into SQL by this repository.
type CurrentIndexResolverRepository struct {
	projects projectStore
}

func NewCurrentIndexResolverRepository(pool *pgxpool.Pool) (*CurrentIndexResolverRepository, error) {
	projects, err := newPostgresProjectStore(pool)
	if err != nil {
		return nil, err
	}
	return &CurrentIndexResolverRepository{projects: projects}, nil
}

func newCurrentIndexResolverRepository(projects projectStore) (*CurrentIndexResolverRepository, error) {
	if projects == nil {
		return nil, errors.New("current index resolver database is required")
	}
	return &CurrentIndexResolverRepository{projects: projects}, nil
}

func (r *CurrentIndexResolverRepository) LoadIndexToolkit(ctx context.Context, projectID, toolkitID int64) (indexingapp.IndexToolkitRecord, error) {
	toolkitID32, err := currentIndexInt32ID(toolkitID)
	if err != nil {
		return indexingapp.IndexToolkitRecord{}, err
	}
	var row sqlcgen.GetCurrentIndexToolkitRow
	err = r.withProjectQueries(ctx, projectID, func(queries *sqlcgen.Queries) error {
		var queryErr error
		row, queryErr = queries.GetCurrentIndexToolkit(ctx, toolkitID32)
		return queryErr
	})
	if err != nil {
		return indexingapp.IndexToolkitRecord{}, currentIndexQueryError("load toolkit", err)
	}
	name := ""
	if row.Name != nil {
		name = *row.Name
	}
	return indexingapp.IndexToolkitRecord{
		ID:       int64(row.ID),
		Name:     name,
		Type:     row.Type,
		Settings: append([]byte(nil), row.Settings...),
	}, nil
}

func (r *CurrentIndexResolverRepository) LoadIndexConfiguration(ctx context.Context, projectID int64, title string) (indexingapp.IndexConfigurationRecord, error) {
	if title == "" {
		return indexingapp.IndexConfigurationRecord{}, indexingapp.ErrIndexResolverRecordNotFound
	}
	var row sqlcgen.GetCurrentIndexConfigurationRow
	err := r.withProjectQueries(ctx, projectID, func(queries *sqlcgen.Queries) error {
		var queryErr error
		row, queryErr = queries.GetCurrentIndexConfiguration(ctx, title)
		return queryErr
	})
	if err != nil {
		return indexingapp.IndexConfigurationRecord{}, currentIndexQueryError("load configuration", err)
	}
	return currentIndexConfigurationRecord(
		row.ConfigurationUuid,
		row.ProjectID,
		row.Type,
		row.Data,
		row.Shared,
		row.StatusOk,
	), nil
}

func (r *CurrentIndexResolverRepository) LoadSharedIndexConfiguration(ctx context.Context, projectID int64, title string) (indexingapp.IndexConfigurationRecord, error) {
	if title == "" {
		return indexingapp.IndexConfigurationRecord{}, indexingapp.ErrIndexResolverRecordNotFound
	}
	var row sqlcgen.GetCurrentSharedIndexConfigurationRow
	err := r.withProjectQueries(ctx, projectID, func(queries *sqlcgen.Queries) error {
		var queryErr error
		row, queryErr = queries.GetCurrentSharedIndexConfiguration(ctx, title)
		return queryErr
	})
	if err != nil {
		return indexingapp.IndexConfigurationRecord{}, currentIndexQueryError("load shared configuration", err)
	}
	return currentIndexConfigurationRecord(
		row.ConfigurationUuid,
		row.ProjectID,
		row.Type,
		row.Data,
		row.Shared,
		row.StatusOk,
	), nil
}

func (r *CurrentIndexResolverRepository) IndexEmbeddingModelExists(ctx context.Context, projectID int64, name string) (bool, error) {
	projectID32, err := currentIndexInt32ID(projectID)
	if err != nil || name == "" {
		return false, indexingapp.ErrIndexResolverRecordNotFound
	}
	var exists bool
	err = r.withProjectQueries(ctx, projectID, func(queries *sqlcgen.Queries) error {
		var queryErr error
		exists, queryErr = queries.CurrentIndexEmbeddingModelExists(ctx, sqlcgen.CurrentIndexEmbeddingModelExistsParams{
			ProjectID: projectID32,
			ModelName: name,
		})
		return queryErr
	})
	if err != nil {
		return false, currentIndexQueryError("load embedding model", err)
	}
	return exists, nil
}

func (r *CurrentIndexResolverRepository) SharedIndexEmbeddingModelExists(ctx context.Context, projectID int64, name string) (bool, error) {
	projectID32, err := currentIndexInt32ID(projectID)
	if err != nil || name == "" {
		return false, indexingapp.ErrIndexResolverRecordNotFound
	}
	var exists bool
	err = r.withProjectQueries(ctx, projectID, func(queries *sqlcgen.Queries) error {
		var queryErr error
		exists, queryErr = queries.SharedIndexEmbeddingModelExists(ctx, sqlcgen.SharedIndexEmbeddingModelExistsParams{
			ProjectID: projectID32,
			ModelName: name,
		})
		return queryErr
	})
	if err != nil {
		return false, currentIndexQueryError("load shared embedding model", err)
	}
	return exists, nil
}

func (r *CurrentIndexResolverRepository) LoadIndexLLMModel(ctx context.Context, projectID int64, name string) (indexingapp.IndexLLMModelRecord, error) {
	projectID32, err := currentIndexInt32ID(projectID)
	if err != nil || name == "" {
		return indexingapp.IndexLLMModelRecord{}, indexingapp.ErrIndexResolverRecordNotFound
	}
	var row sqlcgen.GetCurrentIndexLLMModelRow
	err = r.withProjectQueries(ctx, projectID, func(queries *sqlcgen.Queries) error {
		var queryErr error
		row, queryErr = queries.GetCurrentIndexLLMModel(ctx, sqlcgen.GetCurrentIndexLLMModelParams{
			ProjectID: projectID32,
			ModelName: name,
		})
		return queryErr
	})
	if err != nil {
		return indexingapp.IndexLLMModelRecord{}, currentIndexQueryError("load LLM model", err)
	}
	return currentIndexLLMModelRecord(row.ProjectID, row.Shared, row.ModelName, row.SupportsReasoning, row.OpenaiCompatible, row.MaxOutputTokens), nil
}

func (r *CurrentIndexResolverRepository) LoadSharedIndexLLMModel(ctx context.Context, projectID int64, name string) (indexingapp.IndexLLMModelRecord, error) {
	projectID32, err := currentIndexInt32ID(projectID)
	if err != nil || name == "" {
		return indexingapp.IndexLLMModelRecord{}, indexingapp.ErrIndexResolverRecordNotFound
	}
	var row sqlcgen.GetSharedIndexLLMModelRow
	err = r.withProjectQueries(ctx, projectID, func(queries *sqlcgen.Queries) error {
		var queryErr error
		row, queryErr = queries.GetSharedIndexLLMModel(ctx, sqlcgen.GetSharedIndexLLMModelParams{
			ProjectID: projectID32,
			ModelName: name,
		})
		return queryErr
	})
	if err != nil {
		return indexingapp.IndexLLMModelRecord{}, currentIndexQueryError("load shared LLM model", err)
	}
	return currentIndexLLMModelRecord(row.ProjectID, row.Shared, row.ModelName, row.SupportsReasoning, row.OpenaiCompatible, row.MaxOutputTokens), nil
}

func (r *CurrentIndexResolverRepository) withProjectQueries(ctx context.Context, projectID int64, run func(*sqlcgen.Queries) error) error {
	if _, err := currentIndexInt32ID(projectID); err != nil {
		return err
	}
	return r.projects.WithinProjectTx(ctx, projectID, pgx.TxOptions{
		IsoLevel:   pgx.ReadCommitted,
		AccessMode: pgx.ReadOnly,
	}, func(tx sqlExecutor) error {
		return run(sqlcgen.New(sqlcExecutorAdapter{executor: tx}))
	})
}

func currentIndexConfigurationRecord(uuid string, projectID int32, configurationType string, data []byte, shared, statusOK bool) indexingapp.IndexConfigurationRecord {
	return indexingapp.IndexConfigurationRecord{
		UUID:      uuid,
		ProjectID: int64(projectID),
		Type:      configurationType,
		Data:      append([]byte(nil), data...),
		Shared:    shared,
		StatusOK:  statusOK,
	}
}

func currentIndexLLMModelRecord(projectID int32, shared bool, name string, supportsReasoning, openAICompatible bool, maxOutputTokens int32) indexingapp.IndexLLMModelRecord {
	return indexingapp.IndexLLMModelRecord{
		ProjectID:         int64(projectID),
		Name:              name,
		Shared:            shared,
		SupportsReasoning: supportsReasoning,
		OpenAICompatible:  openAICompatible,
		MaxOutputTokens:   int64(maxOutputTokens),
	}
}

func currentIndexInt32ID(value int64) (int32, error) {
	if value <= 0 || value > math.MaxInt32 {
		return 0, indexingapp.ErrIndexResolverRecordNotFound
	}
	return int32(value), nil
}

func currentIndexQueryError(operation string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, indexingapp.ErrIndexResolverRecordNotFound) {
		return indexingapp.ErrIndexResolverRecordNotFound
	}
	return fmt.Errorf("%s: %w", operation, err)
}

// sqlcExecutorAdapter is intentionally QueryRow-only: every resolver query is
// declared :one. Keeping the projectStore test seam small avoids exposing raw
// pgx transactions outside the tenant executor.
type sqlcExecutorAdapter struct {
	executor sqlExecutor
}

func (a sqlcExecutorAdapter) Exec(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	return a.executor.Exec(ctx, query, args...)
}

func (a sqlcExecutorAdapter) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	return a.executor.QueryRow(ctx, query, args...)
}

func (a sqlcExecutorAdapter) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("current index resolver does not execute multi-row SQLC queries")
}

var _ indexingapp.FixedGitHubResolverStore = (*CurrentIndexResolverRepository)(nil)
var _ sqlcgen.DBTX = sqlcExecutorAdapter{}
