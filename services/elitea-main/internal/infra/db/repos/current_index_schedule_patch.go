package repos

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"

	indexscheduleapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexschedule"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxCurrentIndexScheduleMetadataBytes = 16 << 20

type currentIndexSchedulePatchQueries interface {
	LockCurrentIndexScheduleToolkit(
		context.Context,
		int32,
	) (sqlcgen.LockCurrentIndexScheduleToolkitRow, error)
	UpdateCurrentIndexScheduleToolkitMeta(
		context.Context,
		sqlcgen.UpdateCurrentIndexScheduleToolkitMetaParams,
	) (int64, error)
}

type currentIndexSchedulePatchQueryFactory func(
	sqlExecutor,
) (currentIndexSchedulePatchQueries, error)

type CurrentIndexSchedulePatchRepository struct {
	projects projectStore
	queries  currentIndexSchedulePatchQueryFactory
}

func NewCurrentIndexSchedulePatchRepository(
	pool *pgxpool.Pool,
) (*CurrentIndexSchedulePatchRepository, error) {
	projects, err := newPostgresProjectStore(pool)
	if err != nil {
		return nil, err
	}
	return newCurrentIndexSchedulePatchRepository(
		projects,
		newCurrentIndexSchedulePatchQueries,
	)
}

func newCurrentIndexSchedulePatchRepository(
	projects projectStore,
	queries currentIndexSchedulePatchQueryFactory,
) (*CurrentIndexSchedulePatchRepository, error) {
	if projects == nil || queries == nil {
		return nil, errors.New("current index schedule database is required")
	}
	return &CurrentIndexSchedulePatchRepository{
		projects: projects,
		queries:  queries,
	}, nil
}

func newCurrentIndexSchedulePatchQueries(
	tx sqlExecutor,
) (currentIndexSchedulePatchQueries, error) {
	executor, ok := tx.(pgxExecutor)
	if !ok || executor.queryer == nil {
		return nil, errors.New(
			"current index schedule transaction does not support generated queries",
		)
	}
	return sqlcgen.New(executor.queryer), nil
}

func (repository *CurrentIndexSchedulePatchRepository) Patch(
	ctx context.Context,
	mutation indexscheduleapp.Mutation,
) (indexscheduleapp.MutationResult, error) {
	if repository == nil || repository.projects == nil || ctx == nil ||
		mutation.ProjectID <= 0 || mutation.ProjectID > math.MaxInt32 ||
		mutation.ActorUserID <= 0 || mutation.ActorUserID > math.MaxInt32 ||
		mutation.ToolkitID <= 0 || mutation.ToolkitID > math.MaxInt32 ||
		mutation.IndexMetaID == "" {
		return indexscheduleapp.MutationResult{}, indexscheduleapp.ErrInvalidRequest
	}
	if err := ctx.Err(); err != nil {
		return indexscheduleapp.MutationResult{}, err
	}

	var result indexscheduleapp.MutationResult
	err := repository.projects.WithinProjectTx(
		ctx,
		mutation.ProjectID,
		pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite},
		func(tx sqlExecutor) error {
			queries, err := repository.queries(tx)
			if err != nil {
				return indexscheduleapp.ErrScheduleUnavailable
			}
			toolkit, err := queries.LockCurrentIndexScheduleToolkit(
				ctx,
				int32(mutation.ToolkitID),
			)
			if errors.Is(err, pgx.ErrNoRows) {
				return indexscheduleapp.ErrToolkitNotFound
			}
			if err != nil {
				return indexscheduleapp.ErrScheduleUnavailable
			}
			settingsRaw, metaRaw := toolkit.Settings, toolkit.Meta
			if len(settingsRaw) > maxCurrentIndexScheduleMetadataBytes ||
				len(metaRaw) > maxCurrentIndexScheduleMetadataBytes {
				return indexscheduleapp.ErrScheduleResultTooLarge
			}

			settings, err := decodeCurrentScheduleObject(settingsRaw)
			if err != nil {
				return err
			}
			meta, err := decodeCurrentScheduleObject(metaRaw)
			if err != nil {
				return err
			}
			effectiveUserID, err := currentScheduleEffectiveUser(
				settings,
				mutation.RequestedUserID,
				mutation.ActorUserID,
			)
			if err != nil {
				return err
			}
			indexesMeta, err := currentScheduleObject(meta, "indexes_meta")
			if err != nil {
				return err
			}
			indexEntry, err := currentScheduleObject(indexesMeta, mutation.IndexMetaID)
			if err != nil {
				return err
			}
			schedules, err := currentScheduleObject(indexEntry, "schedules")
			if err != nil {
				return err
			}
			schedule, err := currentScheduleValue(mutation.Schedule)
			if err != nil {
				return err
			}
			schedules[strconv.FormatInt(effectiveUserID, 10)] = schedule
			indexEntry["schedules"] = schedules
			indexesMeta[mutation.IndexMetaID] = indexEntry
			meta["indexes_meta"] = indexesMeta

			updatedMeta, err := json.Marshal(meta)
			if err != nil {
				return indexscheduleapp.ErrInvalidToolkit
			}
			if len(updatedMeta) > maxCurrentIndexScheduleMetadataBytes {
				return indexscheduleapp.ErrScheduleResultTooLarge
			}
			updatedRows, err := queries.UpdateCurrentIndexScheduleToolkitMeta(
				ctx,
				sqlcgen.UpdateCurrentIndexScheduleToolkitMetaParams{
					Meta:      updatedMeta,
					ToolkitID: int32(mutation.ToolkitID),
				},
			)
			if err != nil || updatedRows != 1 {
				return indexscheduleapp.ErrScheduleUnavailable
			}
			result = indexscheduleapp.MutationResult{
				IndexesMeta:     indexesMeta,
				EffectiveUserID: effectiveUserID,
			}
			return nil
		},
	)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) ||
			errors.Is(err, indexscheduleapp.ErrInvalidRequest) ||
			errors.Is(err, indexscheduleapp.ErrToolkitNotFound) ||
			errors.Is(err, indexscheduleapp.ErrInvalidToolkit) ||
			errors.Is(err, indexscheduleapp.ErrScheduleResultTooLarge) {
			return indexscheduleapp.MutationResult{}, err
		}
		return indexscheduleapp.MutationResult{}, indexscheduleapp.ErrScheduleUnavailable
	}
	return result, nil
}

func decodeCurrentScheduleObject(raw []byte) (map[string]any, error) {
	if len(raw) == 0 {
		return nil, indexscheduleapp.ErrInvalidToolkit
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil || value == nil {
		return nil, indexscheduleapp.ErrInvalidToolkit
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, indexscheduleapp.ErrInvalidToolkit
	}
	return value, nil
}

func currentScheduleEffectiveUser(
	settings map[string]any,
	requestedUserID, actorUserID int64,
) (int64, error) {
	pgvector, ok := settings["pgvector_configuration"].(map[string]any)
	if !ok || pgvector == nil {
		return 0, indexscheduleapp.ErrInvalidToolkit
	}
	private, ok := pgvector["private"].(bool)
	if !ok {
		return 0, indexscheduleapp.ErrInvalidToolkit
	}
	if requestedUserID == -1 && private {
		return actorUserID, nil
	}
	return requestedUserID, nil
}

func currentScheduleObject(
	parent map[string]any,
	key string,
) (map[string]any, error) {
	value, exists := parent[key]
	if !exists {
		return map[string]any{}, nil
	}
	if value == nil {
		return nil, indexscheduleapp.ErrInvalidToolkit
	}
	object, ok := value.(map[string]any)
	if !ok || object == nil {
		return nil, indexscheduleapp.ErrInvalidToolkit
	}
	return object, nil
}

func currentScheduleValue(
	schedule indexscheduleapp.Schedule,
) (map[string]any, error) {
	encoded, err := json.Marshal(schedule)
	if err != nil {
		return nil, fmt.Errorf("%w: encode schedule", indexscheduleapp.ErrInvalidRequest)
	}
	return decodeCurrentScheduleObject(encoded)
}

var _ indexscheduleapp.Store = (*CurrentIndexSchedulePatchRepository)(nil)
