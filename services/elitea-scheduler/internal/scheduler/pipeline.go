package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/robfig/cron/v3"

	"github.com/EliteaAI/elitea-platform/services/elitea-scheduler/internal/rpc"
)

// runPipelineScheduling checks all projects for due pipeline triggers and dispatches them.
func runPipelineScheduling(ctx context.Context, pool *pgxpool.Pool, rpcClient *rpc.Client, parser cron.Parser) {
	rows, err := pool.Query(ctx, `SELECT id FROM centry.project WHERE COALESCE(suspended, false) = false`)
	if err != nil {
		slog.Error("scheduler: query projects", "err", err)
		return
	}
	defer rows.Close()

	var projectIDs []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			continue
		}
		projectIDs = append(projectIDs, id)
	}
	rows.Close()

	now := time.Now().UTC().Truncate(time.Minute)
	prev := now.Add(-time.Minute)

	for _, pid := range projectIDs {
		checkProjectPipelines(ctx, pool, rpcClient, parser, pid, now, prev)
	}
}

func checkProjectPipelines(ctx context.Context, pool *pgxpool.Pool, rpcClient *rpc.Client, parser cron.Parser, projectID int, now, prev time.Time) {
	schema := fmt.Sprintf("p_%d", projectID)
	q := fmt.Sprintf(`
		SELECT id, settings->'trigger'->>'schedule' AS cron_expr
		FROM %q.application_versions
		WHERE settings->'trigger'->>'type' = 'schedule'
		  AND settings->'trigger'->>'enabled' = 'true'
		  AND settings->'trigger'->>'schedule' IS NOT NULL`, schema)

	rows, err := pool.Query(ctx, q)
	if err != nil {
		slog.Debug("scheduler: query pipelines", "project", projectID, "err", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var versionID int
		var cronExpr string
		if err := rows.Scan(&versionID, &cronExpr); err != nil {
			continue
		}

		schedule, err := parser.Parse(cronExpr)
		if err != nil {
			slog.Debug("scheduler: invalid cron", "project", projectID, "version", versionID, "cron", cronExpr, "err", err)
			continue
		}

		nextAfterPrev := schedule.Next(prev)
		if !nextAfterPrev.After(now) {
			slog.Info("scheduler: dispatching pipeline", "project", projectID, "version", versionID)
			if err := rpcClient.DispatchPipelineRun(ctx, rpc.PipelineRunPayload{
				ProjectID: fmt.Sprintf("%d", projectID),
				VersionID: versionID,
			}); err != nil {
				slog.Error("scheduler: dispatch failed", "project", projectID, "version", versionID, "err", err)
			}
		}
	}
}
