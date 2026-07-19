package repos

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type ApplicationsRepo struct {
	pool *pgxpool.Pool
}

func NewApplicationsRepo(pool *pgxpool.Pool) *ApplicationsRepo {
	return &ApplicationsRepo{pool: pool}
}

func schema(projectID string) string {
	return fmt.Sprintf("p_%s", projectID)
}

func (r *ApplicationsRepo) List(ctx context.Context, req applications.ListRequest) (applications.ListResponse, error) {
	s := schema(req.ProjectID)

	// Build agent_type filter: "classic" means non-pipeline, "pipeline" means pipeline
	agentTypeFilter := ""
	switch req.AgentsType {
	case "pipeline":
		agentTypeFilter = "pipeline"
	case "classic", "":
		agentTypeFilter = "classic"
	}

	var join string
	switch agentTypeFilter {
	case "pipeline":
		join = fmt.Sprintf(` JOIN %q.application_versions av ON av.application_id = a.id AND av.agent_type = 'pipeline'`, s)
	case "classic":
		join = fmt.Sprintf(` JOIN %q.application_versions av ON av.application_id = a.id AND av.agent_type != 'pipeline'`, s)
	default:
		join = fmt.Sprintf(` LEFT JOIN %q.application_versions av ON av.application_id = a.id`, s)
	}

	// Count query
	countQuery := fmt.Sprintf(`SELECT COUNT(DISTINCT a.id) FROM %q.applications a`, s) + join
	args := []any{}
	argIdx := 1
	where := ""

	if req.Search != "" {
		where += fmt.Sprintf(` WHERE (a.name ILIKE $%d OR a.description ILIKE $%d)`, argIdx, argIdx)
		args = append(args, "%"+req.Search+"%")
	}

	var total int
	if err := r.pool.QueryRow(ctx, countQuery+where, args...).Scan(&total); err != nil {
		return applications.ListResponse{Rows: []applications.Application{}, Total: 0, Page: req.Page, PageSize: req.PageSize}, nil
	}

	offset := (req.Page - 1) * req.PageSize
	query := fmt.Sprintf(`
		SELECT DISTINCT ON (a.id) a.id, a.name, COALESCE(a.description, ''), COALESCE(a.icon, ''),
			a.owner_id, a.created_at, COALESCE(a.shared_id, 0),
			COALESCE(a.meta, '{}'::jsonb)::text,
			COALESCE(av.agent_type, 'openai'),
			COALESCE(u.id, 0), COALESCE(u.email, ''), COALESCE(u.name, '')
		FROM %q.applications a`, s) + join +
		` LEFT JOIN public.auth_core__user u ON u.id = a.owner_id`

	selectArgs := []any{}
	selectIdx := 1
	selectWhere := ""

	if req.Search != "" {
		selectWhere += fmt.Sprintf(` WHERE (a.name ILIKE $%d OR a.description ILIKE $%d)`, selectIdx, selectIdx)
		selectArgs = append(selectArgs, "%"+req.Search+"%")
		selectIdx++
	}

	query += selectWhere + fmt.Sprintf(` ORDER BY a.id DESC LIMIT $%d OFFSET $%d`, selectIdx, selectIdx+1)
	selectArgs = append(selectArgs, req.PageSize, offset)

	rows, err := r.pool.Query(ctx, query, selectArgs...)
	if err != nil {
		return applications.ListResponse{Rows: []applications.Application{}, Total: 0, Page: req.Page, PageSize: req.PageSize}, nil
	}
	defer rows.Close()

	var items []applications.Application
	for rows.Next() {
		var app applications.Application
		var sharedID int
		var metaStr string
		var authorID int
		var authorEmail, authorName string
		if err := rows.Scan(
			&app.ID, &app.Name, &app.Description, &app.Icon,
			&app.OwnerID, &app.CreatedAt, &sharedID,
			&metaStr, &app.AgentType,
			&authorID, &authorEmail, &authorName,
		); err != nil {
			continue
		}
		app.ProjectID = req.ProjectID
		app.IsForked = sharedID > 0
		app.HasInterrupt = false

		// Parse meta JSON
		var meta map[string]any
		if err := json.Unmarshal([]byte(metaStr), &meta); err == nil {
			app.Meta = meta
		} else {
			app.Meta = map[string]any{}
		}

		// Build authors list
		if authorID > 0 {
			app.Authors = []applications.Author{{
				ID:    fmt.Sprintf("%d", authorID),
				Email: authorEmail,
				Name:  authorName,
			}}
		} else {
			app.Authors = []applications.Author{}
		}

		items = append(items, app)
	}
	if items == nil {
		items = []applications.Application{}
	}

	totalPages := total / req.PageSize
	if total%req.PageSize > 0 {
		totalPages++
	}

	return applications.ListResponse{
		Rows:       items,
		Total:      total,
		Page:       req.Page,
		PageSize:   req.PageSize,
		TotalPages: totalPages,
	}, nil
}

func (r *ApplicationsRepo) Get(ctx context.Context, projectID, applicationID string) (applications.Application, error) {
	s := schema(projectID)
	query := fmt.Sprintf(`
		SELECT id, name, COALESCE(description, ''), COALESCE(icon, ''), owner_id,
			created_at, uuid
		FROM %q.applications WHERE id = $1`, s)

	var app applications.Application
	err := r.pool.QueryRow(ctx, query, applicationID).Scan(
		&app.ID, &app.Name, &app.Description,
		&app.Icon, &app.CreatedBy, &app.CreatedAt, &app.ProjectID,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return applications.Application{}, apierr.NotFound("application not found")
		}
		return applications.Application{}, fmt.Errorf("applications: get: %w", err)
	}
	app.ProjectID = projectID
	return app, nil
}

func (r *ApplicationsRepo) Create(ctx context.Context, req applications.CreateRequest) (applications.Application, error) {
	s := schema(req.ProjectID)
	query := fmt.Sprintf(`
		INSERT INTO %q.applications (name, description, icon, owner_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id, name, COALESCE(description, ''), COALESCE(icon, ''), owner_id, created_at, uuid`, s)

	var app applications.Application
	err := r.pool.QueryRow(ctx, query,
		req.Name, req.Description, req.Icon, 1,
	).Scan(
		&app.ID, &app.Name, &app.Description,
		&app.Icon, &app.CreatedBy, &app.CreatedAt, &app.ProjectID,
	)
	if err != nil {
		return applications.Application{}, fmt.Errorf("applications: create: %w", err)
	}
	app.ProjectID = req.ProjectID
	return app, nil
}

func (r *ApplicationsRepo) Update(ctx context.Context, req applications.UpdateRequest) (applications.Application, error) {
	s := schema(req.ProjectID)
	query := fmt.Sprintf(`UPDATE %q.applications SET`, s)
	args := []any{}
	argIdx := 1
	setClauses := ""

	if req.Name != nil {
		setClauses += fmt.Sprintf(` name = $%d,`, argIdx)
		args = append(args, *req.Name)
		argIdx++
	}
	if req.Description != nil {
		setClauses += fmt.Sprintf(` description = $%d,`, argIdx)
		args = append(args, *req.Description)
		argIdx++
	}
	if req.Icon != nil {
		setClauses += fmt.Sprintf(` icon = $%d,`, argIdx)
		args = append(args, *req.Icon)
		argIdx++
	}

	if setClauses == "" {
		return r.Get(ctx, req.ProjectID, req.ApplicationID)
	}

	// Remove trailing comma
	setClauses = setClauses[:len(setClauses)-1]
	query += setClauses + fmt.Sprintf(` WHERE id = $%d RETURNING id, name, COALESCE(description, ''), COALESCE(icon, ''), owner_id, created_at, uuid`, argIdx)
	args = append(args, req.ApplicationID)

	var app applications.Application
	err := r.pool.QueryRow(ctx, query, args...).Scan(
		&app.ID, &app.Name, &app.Description,
		&app.Icon, &app.CreatedBy, &app.CreatedAt, &app.ProjectID,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return applications.Application{}, apierr.NotFound("application not found")
		}
		return applications.Application{}, fmt.Errorf("applications: update: %w", err)
	}
	app.ProjectID = req.ProjectID
	return app, nil
}

func (r *ApplicationsRepo) Delete(ctx context.Context, projectID, applicationID string) error {
	s := schema(projectID)
	// Delete child records first (application_tools, application_variables, tag associations).
	// Errors here are best-effort cascades; we propagate any failure.
	if _, err := r.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.application_tools WHERE application_version_id IN (SELECT id FROM %q.application_versions WHERE application_id = $1)`, s, s), applicationID); err != nil {
		return fmt.Errorf("applications: delete tools: %w", err)
	}
	if _, err := r.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.application_variables WHERE application_version_id IN (SELECT id FROM %q.application_versions WHERE application_id = $1)`, s, s), applicationID); err != nil {
		return fmt.Errorf("applications: delete variables: %w", err)
	}
	if _, err := r.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.application_version_tag_association WHERE version_id IN (SELECT id FROM %q.application_versions WHERE application_id = $1)`, s, s), applicationID); err != nil {
		return fmt.Errorf("applications: delete tag associations: %w", err)
	}
	if _, err := r.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.application_versions WHERE application_id = $1`, s), applicationID); err != nil {
		return fmt.Errorf("applications: delete versions: %w", err)
	}
	query := fmt.Sprintf(`DELETE FROM %q.applications WHERE id = $1`, s)
	ct, err := r.pool.Exec(ctx, query, applicationID)
	if err != nil {
		return fmt.Errorf("applications: delete: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return apierr.NotFound("application not found")
	}
	return nil
}

func (r *ApplicationsRepo) GetVersion(ctx context.Context, projectID, applicationID, versionID string) (applications.Version, error) {
	s := schema(projectID)
	query := fmt.Sprintf(`
		SELECT id, application_id, name, status, created_at
		FROM %q.application_versions
		WHERE application_id = $1 AND id = $2`, s)

	var ver applications.Version
	err := r.pool.QueryRow(ctx, query, applicationID, versionID).Scan(
		&ver.ID, &ver.ApplicationID, &ver.Name,
		&ver.Status, &ver.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return applications.Version{}, apierr.NotFound("version not found")
		}
		return applications.Version{}, fmt.Errorf("applications: get version: %w", err)
	}
	return ver, nil
}

func (r *ApplicationsRepo) ListVersions(ctx context.Context, projectID, applicationID string) ([]applications.Version, error) {
	s := schema(projectID)
	query := fmt.Sprintf(`
		SELECT id, application_id, name, status, created_at
		FROM %q.application_versions
		WHERE application_id = $1
		ORDER BY created_at DESC`, s)

	rows, err := r.pool.Query(ctx, query, applicationID)
	if err != nil {
		return []applications.Version{}, nil
	}
	defer rows.Close()

	var versions []applications.Version
	for rows.Next() {
		var ver applications.Version
		if err := rows.Scan(
			&ver.ID, &ver.ApplicationID, &ver.Name,
			&ver.Status, &ver.CreatedAt,
		); err != nil {
			continue
		}
		versions = append(versions, ver)
	}
	if versions == nil {
		versions = []applications.Version{}
	}
	return versions, nil
}

func (r *ApplicationsRepo) CreateVersion(ctx context.Context, projectID, applicationID string, v applications.Version) (applications.Version, error) {
	s := schema(projectID)
	query := fmt.Sprintf(`
		INSERT INTO %q.application_versions (application_id, name, status, author_id, llm_settings, conversation_starters, welcome_message, agent_type, meta, pipeline_settings)
		VALUES ($1, $2, 'draft', 1, '{}', '[]', '', 'openai', '{}', '{}')
		RETURNING id, application_id, name, status, created_at`, s)

	var ver applications.Version
	err := r.pool.QueryRow(ctx, query, applicationID, v.Name).Scan(
		&ver.ID, &ver.ApplicationID, &ver.Name, &ver.Status, &ver.CreatedAt,
	)
	if err != nil {
		return applications.Version{}, fmt.Errorf("applications: create version: %w", err)
	}
	return ver, nil
}

func (r *ApplicationsRepo) UpdateVersion(ctx context.Context, projectID, applicationID, versionID string, v applications.Version) (applications.Version, error) {
	s := schema(projectID)

	// Build dynamic SET clause
	setClauses := []string{}
	args := []any{}
	argIdx := 1

	if v.Name != "" {
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", argIdx))
		args = append(args, v.Name)
		argIdx++
	}

	if len(setClauses) == 0 {
		setClauses = append(setClauses, "name = name")
	}

	query := fmt.Sprintf(`UPDATE %q.application_versions SET %s WHERE application_id = $%d AND id = $%d RETURNING id, application_id, name, status, created_at`,
		s, joinStrings(setClauses, ", "), argIdx, argIdx+1)
	args = append(args, applicationID, versionID)

	var ver applications.Version
	err := r.pool.QueryRow(ctx, query, args...).Scan(
		&ver.ID, &ver.ApplicationID, &ver.Name, &ver.Status, &ver.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return applications.Version{}, apierr.NotFound("version not found")
		}
		return applications.Version{}, fmt.Errorf("applications: update version: %w", err)
	}
	return ver, nil
}

func joinStrings(s []string, sep string) string {
	result := ""
	for i, v := range s {
		if i > 0 {
			result += sep
		}
		result += v
	}
	return result
}

func (r *ApplicationsRepo) DeleteVersion(ctx context.Context, projectID, applicationID, versionID string) error {
	s := schema(projectID)
	query := fmt.Sprintf(`DELETE FROM %q.application_versions WHERE application_id = $1 AND id = $2`, s)
	ct, err := r.pool.Exec(ctx, query, applicationID, versionID)
	if err != nil {
		return fmt.Errorf("applications: delete version: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return apierr.NotFound("version not found")
	}
	return nil
}

func (r *ApplicationsRepo) SetDefaultVersion(ctx context.Context, projectID, applicationID, versionID string) error {
	s := schema(projectID)
	// Update the application's meta to mark default version
	query := fmt.Sprintf(`
		UPDATE %q.applications SET meta = jsonb_set(COALESCE(meta, '{}')::jsonb, '{default_version_id}', to_jsonb($1::int))
		WHERE id = $2`, s)
	_, err := r.pool.Exec(ctx, query, versionID, applicationID)
	if err != nil {
		return fmt.Errorf("applications: set default version: %w", err)
	}
	return nil
}

func (r *ApplicationsRepo) BatchReplaceVersion(ctx context.Context, projectID, oldVersionID, newVersionID string, deleteOld bool) error {
	s := schema(projectID)
	query := fmt.Sprintf(`
		UPDATE %q.entity_tool_mapping SET entity_version_id = $1 WHERE entity_version_id = $2`, s)
	_, err := r.pool.Exec(ctx, query, newVersionID, oldVersionID)
	if err != nil {
		return fmt.Errorf("applications: batch replace version: %w", err)
	}
	if deleteOld {
		delQ := fmt.Sprintf(`DELETE FROM %q.application_versions WHERE id = $1`, s)
		if _, err := r.pool.Exec(ctx, delQ, oldVersionID); err != nil {
			return fmt.Errorf("applications: batch replace version delete old: %w", err)
		}
	}
	return nil
}
