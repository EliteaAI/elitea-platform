package repos

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"time"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type currentConfigurationQueries interface {
	FindCurrentConfigurationByEliteaTitle(context.Context, sqlcgen.FindCurrentConfigurationByEliteaTitleParams) (sqlcgen.FindCurrentConfigurationByEliteaTitleRow, error)
	CountCurrentConfigurations(context.Context, sqlcgen.CountCurrentConfigurationsParams) (int64, error)
	CountCurrentSharedConfigurations(context.Context, sqlcgen.CountCurrentSharedConfigurationsParams) (int64, error)
	ListCurrentConfigurations(context.Context, sqlcgen.ListCurrentConfigurationsParams) ([]sqlcgen.ListCurrentConfigurationsRow, error)
	ListCurrentSharedConfigurations(context.Context, sqlcgen.ListCurrentSharedConfigurationsParams) ([]sqlcgen.ListCurrentSharedConfigurationsRow, error)
	GetCurrentConfiguration(context.Context, sqlcgen.GetCurrentConfigurationParams) (sqlcgen.GetCurrentConfigurationRow, error)
	InsertCurrentConfiguration(context.Context, sqlcgen.InsertCurrentConfigurationParams) (sqlcgen.InsertCurrentConfigurationRow, error)
	ReplaceCurrentConfiguration(context.Context, sqlcgen.ReplaceCurrentConfigurationParams) (sqlcgen.ReplaceCurrentConfigurationRow, error)
	DeleteCurrentConfiguration(context.Context, sqlcgen.DeleteCurrentConfigurationParams) (int32, error)
}

// FindByEliteaTitle performs the provider-neutral lookup used by current
// configuration expansion. Tenant routing and the row predicate are both
// derived from the authorized project identity; sharedOnly is used only for
// the public-project fallback.
func (r *CurrentConfigurationsRepository) FindByEliteaTitle(
	ctx context.Context,
	projectID int32,
	eliteaTitle string,
	sharedOnly bool,
) (configurationapp.CurrentExpansionConfiguration, bool, error) {
	if ctx == nil ||
		projectID <= 0 ||
		eliteaTitle == "" ||
		len(eliteaTitle) > configurationapp.MaxCurrentExpansionIdentifierLength {
		return configurationapp.CurrentExpansionConfiguration{}, false, configurationapp.ErrInvalidCurrentExpansion
	}
	if err := ctx.Err(); err != nil {
		return configurationapp.CurrentExpansionConfiguration{}, false, err
	}

	var configuration configurationapp.CurrentExpansionConfiguration
	found := false
	err := r.projects.WithinProjectTx(ctx, int64(projectID), pgx.TxOptions{
		IsoLevel:   pgx.ReadCommitted,
		AccessMode: pgx.ReadOnly,
	}, func(tx sqlExecutor) error {
		queries, err := r.queries(tx)
		if err != nil {
			return err
		}
		row, err := queries.FindCurrentConfigurationByEliteaTitle(ctx, sqlcgen.FindCurrentConfigurationByEliteaTitleParams{
			ProjectID:   projectID,
			EliteaTitle: eliteaTitle,
			SharedOnly:  sharedOnly,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("find current configuration row by title: %w", err)
		}
		if row.ProjectID != projectID || (sharedOnly && !row.Shared) {
			return errors.New("current configuration title lookup returned a row outside its authorized scope")
		}
		data, err := decodeCurrentConfigurationJSON(row.Data, "expansion data")
		if err != nil {
			return err
		}
		configuration = configurationapp.CurrentExpansionConfiguration{
			UUID:      row.ConfigurationUuid,
			ProjectID: row.ProjectID,
			Type:      row.Type,
			Data:      data,
		}
		found = true
		return nil
	})
	if err != nil {
		return configurationapp.CurrentExpansionConfiguration{}, false, err
	}
	return configuration, found, nil
}

type currentConfigurationQueryFactory func(sqlExecutor) (currentConfigurationQueries, error)

// CurrentConfigurationsRepository projects the current p_N.configuration
// table through an authorized project transaction. It deliberately owns no
// configuration-registry, secret-expansion, or provider-specific behavior.
type CurrentConfigurationsRepository struct {
	projects projectStore
	queries  currentConfigurationQueryFactory
}

func NewCurrentConfigurationsRepository(pool *pgxpool.Pool) (*CurrentConfigurationsRepository, error) {
	projects, err := newPostgresProjectStore(pool)
	if err != nil {
		return nil, err
	}
	return newCurrentConfigurationsRepository(projects, newCurrentConfigurationQueries)
}

func newCurrentConfigurationsRepository(projects projectStore, queries currentConfigurationQueryFactory) (*CurrentConfigurationsRepository, error) {
	if projects == nil || queries == nil {
		return nil, errors.New("current configuration database is required")
	}
	return &CurrentConfigurationsRepository{projects: projects, queries: queries}, nil
}

func newCurrentConfigurationQueries(tx sqlExecutor) (currentConfigurationQueries, error) {
	executor, ok := tx.(pgxExecutor)
	if !ok || executor.queryer == nil {
		return nil, errors.New("current configuration transaction does not support generated queries")
	}
	return sqlcgen.New(executor.queryer), nil
}

func (r *CurrentConfigurationsRepository) Count(ctx context.Context, filter configurationapp.CurrentConfigurationListFilter) (int64, error) {
	if err := validateCurrentConfigurationRepositoryContext(ctx, filter.ProjectID); err != nil {
		return 0, err
	}

	var total int64
	err := r.projects.WithinProjectTx(ctx, int64(filter.ProjectID), pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadOnly}, func(tx sqlExecutor) error {
		queries, err := r.queries(tx)
		if err != nil {
			return err
		}
		if filter.SharedOnly {
			total, err = queries.CountCurrentSharedConfigurations(ctx, sqlcgen.CountCurrentSharedConfigurationsParams{
				ProjectID: filter.ProjectID,
				Types:     append([]string(nil), filter.Types...),
				Sections:  append([]string(nil), filter.Sections...),
			})
		} else {
			total, err = queries.CountCurrentConfigurations(ctx, sqlcgen.CountCurrentConfigurationsParams{
				ProjectID:  filter.ProjectID,
				Types:      append([]string(nil), filter.Types...),
				Sections:   append([]string(nil), filter.Sections...),
				LabelQuery: filter.LabelQuery,
			})
		}
		if err != nil {
			return fmt.Errorf("count current configurations: %w", err)
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return total, nil
}

func (r *CurrentConfigurationsRepository) List(ctx context.Context, filter configurationapp.CurrentConfigurationListFilter) ([]configurationapp.CurrentConfiguration, error) {
	if err := validateCurrentConfigurationRepositoryContext(ctx, filter.ProjectID); err != nil {
		return nil, err
	}
	offset, limit, err := currentConfigurationPageBounds(filter)
	if err != nil {
		return nil, err
	}

	items := []configurationapp.CurrentConfiguration{}
	err = r.projects.WithinProjectTx(ctx, int64(filter.ProjectID), pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadOnly}, func(tx sqlExecutor) error {
		queries, err := r.queries(tx)
		if err != nil {
			return err
		}

		if filter.SharedOnly {
			rows, err := queries.ListCurrentSharedConfigurations(ctx, sqlcgen.ListCurrentSharedConfigurationsParams{
				ProjectID:  filter.ProjectID,
				Types:      append([]string(nil), filter.Types...),
				Sections:   append([]string(nil), filter.Sections...),
				SortOrder:  filter.SortOrder,
				SortBy:     filter.SortBy,
				OffsetRows: offset,
				LimitRows:  limit,
			})
			if err != nil {
				return fmt.Errorf("list current shared configurations: %w", err)
			}
			items = make([]configurationapp.CurrentConfiguration, 0, len(rows))
			for _, row := range rows {
				item, err := mapCurrentConfiguration(sqlcgen.GetCurrentConfigurationRow(row))
				if err != nil {
					return err
				}
				items = append(items, item)
			}
			return nil
		}

		rows, err := queries.ListCurrentConfigurations(ctx, sqlcgen.ListCurrentConfigurationsParams{
			ProjectID:  filter.ProjectID,
			Types:      append([]string(nil), filter.Types...),
			Sections:   append([]string(nil), filter.Sections...),
			LabelQuery: filter.LabelQuery,
			SortOrder:  filter.SortOrder,
			SortBy:     filter.SortBy,
			OffsetRows: offset,
			LimitRows:  limit,
		})
		if err != nil {
			return fmt.Errorf("list current configurations: %w", err)
		}
		items = make([]configurationapp.CurrentConfiguration, 0, len(rows))
		for _, row := range rows {
			item, err := mapCurrentConfiguration(sqlcgen.GetCurrentConfigurationRow(row))
			if err != nil {
				return err
			}
			items = append(items, item)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (r *CurrentConfigurationsRepository) Get(ctx context.Context, projectID, configurationID int32) (configurationapp.CurrentConfiguration, error) {
	if err := validateCurrentConfigurationRepositoryContext(ctx, projectID); err != nil {
		return configurationapp.CurrentConfiguration{}, err
	}
	if configurationID <= 0 {
		return configurationapp.CurrentConfiguration{}, configurationapp.ErrInvalidCurrentConfigurationRequest
	}

	var configuration configurationapp.CurrentConfiguration
	err := r.projects.WithinProjectTx(ctx, int64(projectID), pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadOnly}, func(tx sqlExecutor) error {
		queries, err := r.queries(tx)
		if err != nil {
			return err
		}
		row, err := queries.GetCurrentConfiguration(ctx, sqlcgen.GetCurrentConfigurationParams{
			ConfigurationID: configurationID,
			ProjectID:       projectID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return configurationapp.ErrCurrentConfigurationNotFound
		}
		if err != nil {
			return fmt.Errorf("get current configuration row: %w", err)
		}
		configuration, err = mapCurrentConfiguration(row)
		return err
	})
	if err != nil {
		return configurationapp.CurrentConfiguration{}, err
	}
	return configuration, nil
}

func (r *CurrentConfigurationsRepository) Create(ctx context.Context, input configurationapp.CurrentConfigurationCreate) (configurationapp.CurrentConfiguration, error) {
	if err := validateCurrentConfigurationRepositoryContext(ctx, input.ProjectID); err != nil {
		return configurationapp.CurrentConfiguration{}, err
	}
	data, meta, err := encodeCurrentConfigurationJSON(input.Data, input.Meta)
	if err != nil {
		return configurationapp.CurrentConfiguration{}, err
	}

	var configuration configurationapp.CurrentConfiguration
	err = r.projects.WithinProjectTx(ctx, int64(input.ProjectID), pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite}, func(tx sqlExecutor) error {
		queries, err := r.queries(tx)
		if err != nil {
			return err
		}
		row, err := queries.InsertCurrentConfiguration(ctx, sqlcgen.InsertCurrentConfigurationParams{
			ConfigurationUuid: input.UUID,
			ProjectID:         input.ProjectID,
			Label:             input.Label,
			EliteaTitle:       input.EliteaTitle,
			ConfigurationType: input.Type,
			Section:           input.Section,
			Data:              data,
			Meta:              meta,
			Shared:            input.Shared,
			StatusOk:          input.StatusOK,
			StatusLogs:        input.StatusLogs,
			Source:            input.Source,
			AuthorID:          input.AuthorID,
		})
		if err := currentConfigurationMutationError(err, false, "insert current configuration row"); err != nil {
			return err
		}
		configuration, err = mapCurrentConfiguration(sqlcgen.GetCurrentConfigurationRow(row))
		return err
	})
	if err != nil {
		return configurationapp.CurrentConfiguration{}, err
	}
	return configuration, nil
}

func (r *CurrentConfigurationsRepository) Replace(ctx context.Context, input configurationapp.CurrentConfigurationReplace) (configurationapp.CurrentConfiguration, error) {
	if err := validateCurrentConfigurationRepositoryContext(ctx, input.ProjectID); err != nil {
		return configurationapp.CurrentConfiguration{}, err
	}
	if input.ConfigurationID <= 0 {
		return configurationapp.CurrentConfiguration{}, configurationapp.ErrInvalidCurrentConfigurationRequest
	}
	data, meta, err := encodeCurrentConfigurationJSON(input.Data, input.Meta)
	if err != nil {
		return configurationapp.CurrentConfiguration{}, err
	}

	var configuration configurationapp.CurrentConfiguration
	err = r.projects.WithinProjectTx(ctx, int64(input.ProjectID), pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite}, func(tx sqlExecutor) error {
		queries, err := r.queries(tx)
		if err != nil {
			return err
		}
		row, err := queries.ReplaceCurrentConfiguration(ctx, sqlcgen.ReplaceCurrentConfigurationParams{
			Label:           input.Label,
			EliteaTitle:     input.EliteaTitle,
			Data:            data,
			Meta:            meta,
			Shared:          input.Shared,
			StatusOk:        input.StatusOK,
			StatusLogs:      input.StatusLogs,
			ConfigurationID: input.ConfigurationID,
			ProjectID:       input.ProjectID,
		})
		if err := currentConfigurationMutationError(err, true, "replace current configuration row"); err != nil {
			return err
		}
		configuration, err = mapCurrentConfiguration(sqlcgen.GetCurrentConfigurationRow(row))
		return err
	})
	if err != nil {
		return configurationapp.CurrentConfiguration{}, err
	}
	return configuration, nil
}

func (r *CurrentConfigurationsRepository) Delete(ctx context.Context, projectID, configurationID int32) error {
	if err := validateCurrentConfigurationRepositoryContext(ctx, projectID); err != nil {
		return err
	}
	if configurationID <= 0 {
		return configurationapp.ErrInvalidCurrentConfigurationRequest
	}
	return r.projects.WithinProjectTx(ctx, int64(projectID), pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite}, func(tx sqlExecutor) error {
		queries, err := r.queries(tx)
		if err != nil {
			return err
		}
		_, err = queries.DeleteCurrentConfiguration(ctx, sqlcgen.DeleteCurrentConfigurationParams{
			ConfigurationID: configurationID,
			ProjectID:       projectID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return configurationapp.ErrCurrentConfigurationNotFound
		}
		if err != nil {
			return fmt.Errorf("delete current configuration row: %w", err)
		}
		return nil
	})
}

func currentConfigurationPageBounds(filter configurationapp.CurrentConfigurationListFilter) (int32, int32, error) {
	if filter.ProjectID <= 0 || filter.Offset < 0 || filter.Limit <= 0 || filter.Offset > math.MaxInt32 || filter.Limit > math.MaxInt32 {
		return 0, 0, configurationapp.ErrInvalidCurrentConfigurationRequest
	}
	return int32(filter.Offset), int32(filter.Limit), nil
}

func encodeCurrentConfigurationJSON(data, meta map[string]any) ([]byte, []byte, error) {
	if data == nil {
		data = map[string]any{}
	}
	if meta == nil {
		meta = map[string]any{}
	}
	dataJSON, err := json.Marshal(data)
	if err != nil {
		return nil, nil, fmt.Errorf("encode current configuration data: %w", err)
	}
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		return nil, nil, fmt.Errorf("encode current configuration metadata: %w", err)
	}
	return dataJSON, metaJSON, nil
}

func currentConfigurationMutationError(err error, noRowsMeansNotFound bool, operation string) error {
	if err == nil {
		return nil
	}
	if noRowsMeansNotFound && errors.Is(err, pgx.ErrNoRows) {
		return configurationapp.ErrCurrentConfigurationNotFound
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23505" {
		return configurationapp.ErrCurrentConfigurationConflict
	}
	return fmt.Errorf("%s: %w", operation, err)
}

func mapCurrentConfiguration(row sqlcgen.GetCurrentConfigurationRow) (configurationapp.CurrentConfiguration, error) {
	if !row.CreatedAt.Valid {
		return configurationapp.CurrentConfiguration{}, errors.New("current configuration row has no creation time")
	}
	data, err := decodeCurrentConfigurationJSON(row.Data, "data")
	if err != nil {
		return configurationapp.CurrentConfiguration{}, err
	}
	meta, err := decodeCurrentConfigurationJSON(row.Meta, "metadata")
	if err != nil {
		return configurationapp.CurrentConfiguration{}, err
	}

	var updatedAt *time.Time
	if row.UpdatedAt.Valid {
		value := row.UpdatedAt.Time
		updatedAt = &value
	}
	return configurationapp.CurrentConfiguration{
		ID:          row.ID,
		UUID:        row.ConfigurationUuid,
		ProjectID:   row.ProjectID,
		Label:       row.Label,
		EliteaTitle: row.EliteaTitle,
		Type:        row.Type,
		Section:     row.Section,
		Data:        data,
		Meta:        meta,
		Shared:      row.Shared,
		StatusOK:    row.StatusOk,
		StatusLogs:  row.StatusLogs,
		Source:      row.Source,
		AuthorID:    row.AuthorID,
		CreatedAt:   row.CreatedAt.Time,
		UpdatedAt:   updatedAt,
	}, nil
}

func decodeCurrentConfigurationJSON(raw []byte, field string) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(append([]byte(nil), raw...)))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("decode current configuration %s: invalid JSON object", field)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("decode current configuration %s: invalid trailing data", field)
	}
	if value == nil {
		return nil, fmt.Errorf("decode current configuration %s: JSON object is required", field)
	}
	return value, nil
}

func validateCurrentConfigurationRepositoryContext(ctx context.Context, projectID int32) error {
	if ctx == nil || projectID <= 0 {
		return configurationapp.ErrInvalidCurrentConfigurationRequest
	}
	return ctx.Err()
}

var _ configurationapp.CurrentConfigurationRepository = (*CurrentConfigurationsRepository)(nil)
var _ configurationapp.CurrentExpansionFinder = (*CurrentConfigurationsRepository)(nil)
