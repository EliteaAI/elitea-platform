package middleware

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// personalProjectNameTemplate mirrors pylon's PROJECT_PERSONAL_NAME_TEMPLATE
// ("project_user_{user_id}").
const personalProjectNameTemplate = "project_user_%s"

// rowQuerier is the minimal subset of *pgxpool.Pool the resolver needs. It lets
// tests substitute a fake without a live database.
type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// DBPersonalProjectResolver resolves a user's personal project id from Postgres,
// mirroring pylon's projects_get_personal_project_id RPC:
//
//	project = SELECT id FROM centry.project WHERE name = 'project_user_<uid>'
//	if project exists AND user is a member of it → return project.id
//	if project missing → fall back to the system-user email pattern
//	                     'system_user_<n>@centry.user' → return <n>
type DBPersonalProjectResolver struct {
	pool rowQuerier
}

// NewDBPersonalProjectResolver builds a resolver backed by the given pool.
func NewDBPersonalProjectResolver(pool *pgxpool.Pool) *DBPersonalProjectResolver {
	return &DBPersonalProjectResolver{pool: pool}
}

// PersonalProjectID implements PersonalProjectResolver.
func (r *DBPersonalProjectResolver) PersonalProjectID(ctx context.Context, userID string) (int, error) {
	if userID == "" {
		return 0, nil
	}
	if r.pool == nil {
		return 0, errors.New("project resolver: nil pool")
	}

	projectName := fmt.Sprintf(personalProjectNameTemplate, userID)

	var projectID int
	err := r.pool.QueryRow(ctx,
		`SELECT id FROM centry.project WHERE name = $1 LIMIT 1`, projectName,
	).Scan(&projectID)

	switch {
	case err == nil:
		// The named personal project exists; confirm the caller is a member of
		// it before trusting it (mirrors admin_check_user_in_project).
		member, mErr := r.userInProject(ctx, projectID, userID)
		if mErr != nil {
			return 0, mErr
		}
		if member {
			return projectID, nil
		}
		// Named project exists but the user is not a member: fall through to the
		// email-pattern fallback below.
		return r.projectIDFromSystemEmail(ctx, userID)
	case errors.Is(err, pgx.ErrNoRows):
		return r.projectIDFromSystemEmail(ctx, userID)
	default:
		return 0, err
	}
}

// userInProject reports whether userID has any role in projectID.
func (r *DBPersonalProjectResolver) userInProject(ctx context.Context, projectID int, userID string) (bool, error) {
	uid, err := strconv.Atoi(userID)
	if err != nil {
		return false, nil
	}
	var exists bool
	err = r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM auth_core__project_user_role
			WHERE project_id = $1 AND user_id = $2
		)`, projectID, uid).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// projectIDFromSystemEmail implements pylon's fallback: when there is no named
// personal project, a system user whose email matches
// 'system_user_<n>@centry.user' resolves to project id <n>.
func (r *DBPersonalProjectResolver) projectIDFromSystemEmail(ctx context.Context, userID string) (int, error) {
	uid, err := strconv.Atoi(userID)
	if err != nil {
		return 0, nil
	}
	var email string
	err = r.pool.QueryRow(ctx,
		`SELECT COALESCE(email, '') FROM auth_core__user WHERE id = $1`, uid,
	).Scan(&email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	if m := systemUserEmailRe.FindStringSubmatch(email); m != nil {
		if id, convErr := strconv.Atoi(m[1]); convErr == nil {
			return id, nil
		}
	}
	return 0, nil
}
