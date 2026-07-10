package repos

import (
	"context"
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

	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM %q.applications`, s)
	args := []any{}
	argIdx := 1
	where := ""

	if req.Search != "" {
		where += fmt.Sprintf(` WHERE (name ILIKE $%d OR description ILIKE $%d)`, argIdx, argIdx)
		args = append(args, "%"+req.Search+"%")
		argIdx++
	}

	var total int
	if err := r.pool.QueryRow(ctx, countQuery+where, args...).Scan(&total); err != nil {
		// Schema doesn't exist yet — return empty
		return applications.ListResponse{Items: []applications.Application{}, Total: 0, Page: req.Page, PageSize: req.PageSize}, nil
	}

	offset := (req.Page - 1) * req.PageSize
	query := fmt.Sprintf(`
		SELECT id, name, COALESCE(description, ''), COALESCE(icon, ''), owner_id,
			created_at, uuid
		FROM %q.applications`, s)

	selectArgs := []any{}
	selectIdx := 1
	selectWhere := ""

	if req.Search != "" {
		selectWhere += fmt.Sprintf(` WHERE (name ILIKE $%d OR description ILIKE $%d)`, selectIdx, selectIdx)
		selectArgs = append(selectArgs, "%"+req.Search+"%")
		selectIdx++
	}

	query += selectWhere + fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d OFFSET $%d`, selectIdx, selectIdx+1)
	selectArgs = append(selectArgs, req.PageSize, offset)

	rows, err := r.pool.Query(ctx, query, selectArgs...)
	if err != nil {
		return applications.ListResponse{Items: []applications.Application{}, Total: 0, Page: req.Page, PageSize: req.PageSize}, nil
	}
	defer rows.Close()

	var items []applications.Application
	for rows.Next() {
		var app applications.Application
		if err := rows.Scan(
			&app.ID, &app.Name, &app.Description,
			&app.Icon, &app.CreatedBy, &app.CreatedAt, &app.ProjectID,
		); err != nil {
			continue
		}
		app.ProjectID = req.ProjectID
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
		Items:      items,
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
		INSERT INTO %q.application_versions (application_id, name, status, author_id)
		VALUES ($1, $2, 'draft', 1)
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
	query := fmt.Sprintf(`
		UPDATE %q.application_versions SET name = $1
		WHERE application_id = $2 AND id = $3
		RETURNING id, application_id, name, status, created_at`, s)

	var ver applications.Version
	err := r.pool.QueryRow(ctx, query, v.Name, applicationID, versionID).Scan(
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
		r.pool.Exec(ctx, delQ, oldVersionID)
	}
	return nil
}
