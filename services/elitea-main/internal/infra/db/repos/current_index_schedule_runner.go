package repos

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"

	indexscheduleapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexschedule"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maxCurrentIndexSchedulePageRows             = 128
	maxCurrentIndexScheduleCandidatesPerToolkit = 16_384
)

type CurrentIndexScheduleCatalog struct {
	shared   sharedStore
	projects projectStore
}

func NewCurrentIndexScheduleCatalog(
	pool *pgxpool.Pool,
) (*CurrentIndexScheduleCatalog, error) {
	shared, err := newPostgresSharedStore(pool)
	if err != nil {
		return nil, err
	}
	projects, err := newPostgresProjectStore(pool)
	if err != nil {
		return nil, err
	}
	return newCurrentIndexScheduleCatalog(shared, projects)
}

func newCurrentIndexScheduleCatalog(
	shared sharedStore,
	projects projectStore,
) (*CurrentIndexScheduleCatalog, error) {
	if shared == nil || projects == nil {
		return nil, errors.New("current index schedule catalog database is required")
	}
	return &CurrentIndexScheduleCatalog{shared: shared, projects: projects}, nil
}

func (catalog *CurrentIndexScheduleCatalog) ListProjectPage(
	ctx context.Context,
	afterProjectID int64,
	limit int,
) ([]int64, error) {
	if catalog == nil || catalog.shared == nil || ctx == nil ||
		afterProjectID < 0 || afterProjectID > math.MaxInt32 ||
		limit <= 0 || limit > maxCurrentIndexSchedulePageRows {
		return nil, indexscheduleapp.ErrInvalidRequest
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	rows, err := catalog.shared.Query(ctx, `
SELECT project.id::integer
FROM centry.project AS project
WHERE project.create_success IS TRUE
  AND project.id > $1::integer
ORDER BY project.id
LIMIT $2::integer`,
		afterProjectID,
		limit,
	)
	if err != nil {
		return nil, scheduleCatalogDependency(ctx, "list projects", err)
	}
	defer rows.Close()

	result := make([]int64, 0, limit)
	previous := afterProjectID
	for rows.Next() {
		var projectID int64
		if err := rows.Scan(&projectID); err != nil {
			return nil, scheduleCatalogDependency(ctx, "scan project", err)
		}
		if projectID <= previous || projectID > math.MaxInt32 ||
			len(result) >= limit {
			return nil, indexscheduleapp.ErrScheduleDependency
		}
		result = append(result, projectID)
		previous = projectID
	}
	if err := rows.Err(); err != nil {
		return nil, scheduleCatalogDependency(ctx, "iterate projects", err)
	}
	return result, nil
}

func (catalog *CurrentIndexScheduleCatalog) ListToolkitSchedulePage(
	ctx context.Context,
	projectID int64,
	afterToolkitID int64,
	limit int,
) ([]indexscheduleapp.ToolkitSchedules, error) {
	if catalog == nil || catalog.projects == nil || ctx == nil ||
		projectID <= 0 || projectID > math.MaxInt32 ||
		afterToolkitID < 0 || afterToolkitID > math.MaxInt32 ||
		limit <= 0 || limit > maxCurrentIndexSchedulePageRows {
		return nil, indexscheduleapp.ErrInvalidRequest
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	result := make([]indexscheduleapp.ToolkitSchedules, 0, limit)
	err := catalog.projects.WithinProjectTx(
		ctx,
		projectID,
		pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadOnly},
		func(tx sqlExecutor) error {
			rows, err := tx.Query(ctx, `
SELECT toolkit.id,
       toolkit.type,
       toolkit.meta -> 'indexes_meta'
FROM elitea_tools AS toolkit
WHERE toolkit.id > $1::integer
  AND jsonb_typeof(toolkit.meta -> 'indexes_meta') = 'object'
ORDER BY toolkit.id
LIMIT $2::integer`,
				afterToolkitID,
				limit,
			)
			if err != nil {
				return scheduleCatalogDependency(ctx, "list toolkits", err)
			}
			defer rows.Close()

			previous := afterToolkitID
			for rows.Next() {
				var toolkitID int64
				var toolkitType string
				var indexesMetaRaw []byte
				if err := rows.Scan(&toolkitID, &toolkitType, &indexesMetaRaw); err != nil {
					return scheduleCatalogDependency(ctx, "scan toolkit", err)
				}
				if toolkitID <= previous || toolkitID > math.MaxInt32 ||
					toolkitType == "" ||
					len(toolkitType) > indexscheduleapp.MaxCredentialTitleBytes ||
					len(indexesMetaRaw) == 0 ||
					len(indexesMetaRaw) > maxCurrentIndexScheduleMetadataBytes ||
					len(result) >= limit {
					return indexscheduleapp.ErrScheduleDependency
				}
				candidates, err := currentToolkitScheduleCandidates(
					projectID,
					toolkitID,
					toolkitType,
					indexesMetaRaw,
				)
				if err != nil {
					return err
				}
				result = append(result, indexscheduleapp.ToolkitSchedules{
					ProjectID:  projectID,
					ToolkitID:  toolkitID,
					Candidates: candidates,
				})
				previous = toolkitID
			}
			if err := rows.Err(); err != nil {
				return scheduleCatalogDependency(ctx, "iterate toolkits", err)
			}
			return nil
		},
	)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (catalog *CurrentIndexScheduleCatalog) MarkLastRun(
	ctx context.Context,
	candidate indexscheduleapp.Candidate,
	at time.Time,
) (bool, error) {
	if catalog == nil || catalog.projects == nil || ctx == nil ||
		candidate.ProjectID <= 0 || candidate.ProjectID > math.MaxInt32 ||
		candidate.ToolkitID <= 0 || candidate.ToolkitID > math.MaxInt32 ||
		candidate.IndexMetaID == "" ||
		(candidate.ScheduleUserID != -1 && candidate.ScheduleUserID <= 0) ||
		at.IsZero() {
		return false, indexscheduleapp.ErrInvalidRequest
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}

	updated := false
	err := catalog.projects.WithinProjectTx(
		ctx,
		candidate.ProjectID,
		pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite},
		func(tx sqlExecutor) error {
			var metaRaw []byte
			err := tx.QueryRow(ctx, `
SELECT toolkit.meta
FROM elitea_tools AS toolkit
WHERE toolkit.id = $1::integer
FOR UPDATE`,
				candidate.ToolkitID,
			).Scan(&metaRaw)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			if err != nil {
				return scheduleCatalogDependency(ctx, "lock toolkit", err)
			}
			if len(metaRaw) == 0 ||
				len(metaRaw) > maxCurrentIndexScheduleMetadataBytes {
				return indexscheduleapp.ErrScheduleDependency
			}
			meta, err := decodeCurrentScheduleObject(metaRaw)
			if err != nil {
				return err
			}
			indexes, ok := scheduleObjectValue(meta["indexes_meta"])
			if !ok {
				return nil
			}
			index, ok := scheduleObjectValue(indexes[candidate.IndexMetaID])
			if !ok {
				return nil
			}
			schedules, ok := scheduleObjectValue(index["schedules"])
			if !ok {
				return nil
			}
			key := strconv.FormatInt(candidate.ScheduleUserID, 10)
			rawSchedule, exists := schedules[key]
			if !exists {
				return nil
			}
			stored, err := decodeCurrentStoredSchedule(rawSchedule)
			if err != nil || !sameCurrentSchedule(stored, candidate.Schedule) {
				return nil
			}
			rawObject, ok := scheduleObjectValue(rawSchedule)
			if !ok {
				return nil
			}
			// Mutate only last_run, matching the current Python row refresh and
			// preserving forward-compatible schedule and credential fields.
			rawObject["last_run"] = formatCurrentScheduleLastRun(at)
			schedules[key] = rawObject
			index["schedules"] = schedules
			indexes[candidate.IndexMetaID] = index
			meta["indexes_meta"] = indexes
			encoded, err := json.Marshal(meta)
			if err != nil ||
				len(encoded) > maxCurrentIndexScheduleMetadataBytes {
				return indexscheduleapp.ErrScheduleResultTooLarge
			}
			tag, err := tx.Exec(ctx, `
UPDATE elitea_tools
SET meta = $1::jsonb,
    updated_at = clock_timestamp()
WHERE id = $2::integer`,
				encoded,
				candidate.ToolkitID,
			)
			if err != nil {
				return scheduleCatalogDependency(ctx, "update last_run", err)
			}
			if tag.RowsAffected() != 1 {
				return indexscheduleapp.ErrScheduleDependency
			}
			updated = true
			return nil
		},
	)
	if err != nil {
		return false, err
	}
	return updated, nil
}

func currentToolkitScheduleCandidates(
	projectID, toolkitID int64,
	toolkitType string,
	metaRaw []byte,
) ([]indexscheduleapp.Candidate, error) {
	indexes, err := decodeCurrentScheduleObject(metaRaw)
	if err != nil {
		return nil, err
	}
	indexIDs := sortedScheduleKeys(indexes)
	result := make([]indexscheduleapp.Candidate, 0)
	for _, indexMetaID := range indexIDs {
		index, ok := scheduleObjectValue(indexes[indexMetaID])
		if !ok {
			continue
		}
		schedules, ok := scheduleObjectValue(index["schedules"])
		if !ok {
			continue
		}
		for _, userKey := range sortedScheduleKeys(schedules) {
			userID, parseErr := strconv.ParseInt(userKey, 10, 64)
			schedule, scheduleErr := decodeCurrentStoredSchedule(schedules[userKey])
			if parseErr != nil || (userID != -1 && userID <= 0) ||
				scheduleErr != nil {
				userID = 0
				schedule = indexscheduleapp.Schedule{}
			}
			result = append(result, indexscheduleapp.Candidate{
				ProjectID: projectID, ToolkitID: toolkitID,
				ToolkitType: toolkitType, IndexMetaID: indexMetaID,
				ScheduleUserID: userID, Schedule: schedule,
			})
			if len(result) > maxCurrentIndexScheduleCandidatesPerToolkit {
				return nil, indexscheduleapp.ErrScheduleResultTooLarge
			}
		}
	}
	return result, nil
}

func decodeCurrentStoredSchedule(
	value any,
) (indexscheduleapp.Schedule, error) {
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded) == 0 ||
		len(encoded) > maxCurrentIndexScheduleMetadataBytes {
		return indexscheduleapp.Schedule{}, indexscheduleapp.ErrInvalidStoredSchedule
	}
	var schedule indexscheduleapp.Schedule
	if err := json.Unmarshal(encoded, &schedule); err != nil {
		return indexscheduleapp.Schedule{}, indexscheduleapp.ErrInvalidStoredSchedule
	}
	return schedule, nil
}

func scheduleObjectValue(value any) (map[string]any, bool) {
	object, ok := value.(map[string]any)
	return object, ok && object != nil
}

func sortedScheduleKeys(value map[string]any) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sameCurrentSchedule(
	left, right indexscheduleapp.Schedule,
) bool {
	if left.Cron != right.Cron ||
		left.Enabled != right.Enabled ||
		left.CreatedBy != right.CreatedBy ||
		left.Timezone != right.Timezone ||
		left.LastRun != right.LastRun {
		return false
	}
	if left.Credentials == nil || right.Credentials == nil {
		return left.Credentials == nil && right.Credentials == nil
	}
	if left.Credentials.EliteaTitle != right.Credentials.EliteaTitle {
		return false
	}
	if left.Credentials.Private == nil || right.Credentials.Private == nil {
		return left.Credentials.Private == nil && right.Credentials.Private == nil
	}
	return *left.Credentials.Private == *right.Credentials.Private
}

func formatCurrentScheduleLastRun(value time.Time) string {
	value = value.UTC().Truncate(time.Microsecond)
	if value.Nanosecond() == 0 {
		return value.Format("2006-01-02T15:04:05+00:00")
	}
	return value.Format("2006-01-02T15:04:05.000000+00:00")
}

func scheduleCatalogDependency(
	ctx context.Context,
	operation string,
	err error,
) error {
	if ctx != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
	}
	return fmt.Errorf(
		"%w: %s: %v",
		indexscheduleapp.ErrScheduleDependency,
		operation,
		err,
	)
}

var _ indexscheduleapp.Catalog = (*CurrentIndexScheduleCatalog)(nil)
