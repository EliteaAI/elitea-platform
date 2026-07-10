package repos

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/analytics"
)

type AnalyticsRepo struct {
	pool *pgxpool.Pool
}

func NewAnalyticsRepo(pool *pgxpool.Pool) *AnalyticsRepo {
	return &AnalyticsRepo{pool: pool}
}

func (r *AnalyticsRepo) GetUsageSummary(ctx context.Context, params analytics.QueryParams) (analytics.UsageSummary, error) {
	query := `SELECT COALESCE(SUM(total_tokens), 0), COALESCE(SUM(total_cost), 0), COUNT(*)
		FROM usage_records WHERE project_id = $1`
	args := []any{params.ProjectID}

	if params.StartDate != "" {
		query += ` AND created_at >= $2`
		args = append(args, params.StartDate)
	}
	if params.EndDate != "" {
		query += fmt.Sprintf(` AND created_at <= $%d`, len(args)+1)
		args = append(args, params.EndDate)
	}

	var summary analytics.UsageSummary
	err := r.pool.QueryRow(ctx, query, args...).Scan(
		&summary.TotalTokens, &summary.TotalCost, &summary.TotalRuns,
	)
	if err != nil {
		return analytics.UsageSummary{}, fmt.Errorf("analytics: usage summary: %w", err)
	}
	summary.ProjectID = params.ProjectID
	summary.Period = params.Period
	return summary, nil
}

func (r *AnalyticsRepo) GetAgentAnalytics(ctx context.Context, params analytics.QueryParams) ([]analytics.AgentAnalytics, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT application_id, a.name, COUNT(*) as run_count,
			AVG(duration_ms) as avg_duration, COALESCE(SUM(total_tokens), 0) as total_tokens,
			COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) as error_rate
		FROM usage_records u
		JOIN applications a ON a.id = u.application_id
		WHERE u.project_id = $1
		GROUP BY application_id, a.name
		ORDER BY run_count DESC`, params.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("analytics: agents: %w", err)
	}
	defer rows.Close()

	var items []analytics.AgentAnalytics
	for rows.Next() {
		var a analytics.AgentAnalytics
		if err := rows.Scan(&a.ApplicationID, &a.Name, &a.RunCount, &a.AvgDuration, &a.TotalTokens, &a.ErrorRate); err != nil {
			return nil, fmt.Errorf("analytics: scan agent: %w", err)
		}
		items = append(items, a)
	}
	return items, nil
}

func (r *AnalyticsRepo) GetToolAnalytics(ctx context.Context, params analytics.QueryParams) ([]analytics.ToolAnalytics, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT toolkit_id, tool_name, COUNT(*) as run_count,
			AVG(duration_ms) as avg_duration,
			COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) as error_rate
		FROM tool_usage_records
		WHERE project_id = $1
		GROUP BY toolkit_id, tool_name
		ORDER BY run_count DESC`, params.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("analytics: tools: %w", err)
	}
	defer rows.Close()

	var items []analytics.ToolAnalytics
	for rows.Next() {
		var t analytics.ToolAnalytics
		if err := rows.Scan(&t.ToolkitID, &t.ToolName, &t.RunCount, &t.AvgDuration, &t.ErrorRate); err != nil {
			return nil, fmt.Errorf("analytics: scan tool: %w", err)
		}
		items = append(items, t)
	}
	return items, nil
}

func (r *AnalyticsRepo) GetUserActivity(ctx context.Context, params analytics.QueryParams) ([]analytics.UserActivity, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT user_id, email, COUNT(*) as run_count, MAX(created_at) as last_active_at
		FROM usage_records
		WHERE project_id = $1
		GROUP BY user_id, email
		ORDER BY run_count DESC`, params.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("analytics: users: %w", err)
	}
	defer rows.Close()

	var items []analytics.UserActivity
	for rows.Next() {
		var u analytics.UserActivity
		if err := rows.Scan(&u.UserID, &u.Email, &u.RunCount, &u.LastActiveAt); err != nil {
			return nil, fmt.Errorf("analytics: scan user: %w", err)
		}
		items = append(items, u)
	}
	return items, nil
}
