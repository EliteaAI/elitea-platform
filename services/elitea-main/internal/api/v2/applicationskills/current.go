package applicationskills

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/tenant"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	CurrentApplicationSkillsPath       = "/api/v2/elitea_core/application_skills/prompt_lib/{projectID}/{appVersionID}"
	CurrentApplicationSkillsMode       = auth.PermissionModeDefault
	CurrentApplicationSkillsPermission = "models.applications.applications.details"
	MaxCurrentApplicationSkills        = 5
)

var (
	ErrInvalidCurrentApplicationSkillsRoute   = errors.New("invalid current application-skills route dependencies")
	ErrInvalidCurrentApplicationSkillsRequest = errors.New("current application-skills request is invalid")
)

// CurrentApplicationSkill is the exact presentation shape returned by the
// current application_skills endpoint. VersionID remains nullable because
// current tenant schemas allow a mapping whose selected version is absent.
type CurrentApplicationSkill struct {
	Name           string          `json:"name"`
	Description    string          `json:"description"`
	SkillID        int32           `json:"skill_id"`
	VersionID      *int32          `json:"version_id"`
	VersionName    string          `json:"version_name"`
	VersionMissing bool            `json:"version_missing"`
	IconMeta       json.RawMessage `json:"icon_meta"`
}

type CurrentApplicationSkillsReader interface {
	ListCurrentApplicationSkills(
		context.Context,
		int32,
		int32,
	) ([]CurrentApplicationSkill, error)
}

// CurrentApplicationSkillsRepository reads one already-authorized tenant
// through a transaction-local search_path. Caller-provided schema names never
// enter the query.
type CurrentApplicationSkillsRepository struct {
	tenants *tenant.Executor
}

func NewCurrentApplicationSkillsRepository(
	pool *pgxpool.Pool,
) (*CurrentApplicationSkillsRepository, error) {
	if pool == nil {
		return nil, errors.New("current application-skills database is required")
	}
	return &CurrentApplicationSkillsRepository{tenants: tenant.NewExecutor(pool)}, nil
}

func (repository *CurrentApplicationSkillsRepository) ListCurrentApplicationSkills(
	ctx context.Context,
	projectID int32,
	appVersionID int32,
) ([]CurrentApplicationSkill, error) {
	if repository == nil || repository.tenants == nil || ctx == nil ||
		projectID <= 0 || appVersionID <= 0 {
		return nil, ErrInvalidCurrentApplicationSkillsRequest
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	skills := []CurrentApplicationSkill{}
	err := repository.tenants.WithinTx(
		ctx,
		tenant.Project{ID: int64(projectID)},
		pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadOnly},
		func(ctx context.Context, tx pgx.Tx) error {
			rows, err := tx.Query(ctx, `
SELECT
    skill.name,
    skill.description,
    mapping.skill_id,
    mapping.skill_version_id,
    CASE WHEN version.id IS NULL THEN 'unknown' ELSE version.name END,
    version.id IS NULL,
    CASE
        WHEN version.id IS NULL THEN 'null'::jsonb
        ELSE COALESCE(version.meta -> 'icon_meta', 'null'::jsonb)
    END
FROM entity_skill_mapping AS mapping
JOIN skills AS skill
  ON skill.id = mapping.skill_id
LEFT JOIN skill_versions AS version
  ON version.id = mapping.skill_version_id
WHERE mapping.entity_version_id = $1
  AND mapping.entity_type = 'agent'`,
				appVersionID,
			)
			if err != nil {
				return fmt.Errorf("list current application skills: %w", err)
			}
			defer rows.Close()

			for rows.Next() {
				var skill CurrentApplicationSkill
				var iconMeta []byte
				if err := rows.Scan(
					&skill.Name,
					&skill.Description,
					&skill.SkillID,
					&skill.VersionID,
					&skill.VersionName,
					&skill.VersionMissing,
					&iconMeta,
				); err != nil {
					return fmt.Errorf("scan current application skill: %w", err)
				}
				skill.IconMeta = json.RawMessage(bytes.Clone(iconMeta))
				skills = append(skills, skill)
			}
			if err := rows.Err(); err != nil {
				return fmt.Errorf("iterate current application skills: %w", err)
			}
			return nil
		},
	)
	if err != nil {
		return nil, err
	}
	return skills, nil
}

var _ CurrentApplicationSkillsReader = (*CurrentApplicationSkillsRepository)(nil)

// CurrentApplicationSkillsRoute owns only the current attached-skills GET and
// remains unmounted until production composition explicitly selects the slice.
type CurrentApplicationSkillsRoute struct {
	handler http.Handler
}

func NewCurrentApplicationSkillsRoute(
	reader CurrentApplicationSkillsReader,
	authConfig apimw.AuthConfig,
	permissions auth.PermissionResolver,
) (*CurrentApplicationSkillsRoute, error) {
	if reader == nil || authConfig.PrincipalValidator == nil ||
		authConfig.ForwardedIdentityVerifier == nil || permissions == nil {
		return nil, ErrInvalidCurrentApplicationSkillsRoute
	}

	handler := &currentApplicationSkillsHandler{reader: reader}
	endpoint := http.Handler(http.HandlerFunc(handler.list))
	endpoint = apimw.RequireResolvedPermissionsForProject(
		permissions,
		CurrentApplicationSkillsMode,
		currentApplicationSkillsProjectID,
		CurrentApplicationSkillsPermission,
	)(endpoint)
	endpoint = apimw.Auth(authConfig)(endpoint)

	router := chi.NewRouter()
	router.Method(http.MethodGet, CurrentApplicationSkillsPath, endpoint)
	return &CurrentApplicationSkillsRoute{handler: router}, nil
}

func (route *CurrentApplicationSkillsRoute) ServeHTTP(
	writer http.ResponseWriter,
	request *http.Request,
) {
	if route == nil || route.handler == nil {
		http.NotFound(writer, request)
		return
	}
	route.handler.ServeHTTP(writer, request)
}

type currentApplicationSkillsHandler struct {
	reader CurrentApplicationSkillsReader
}

type currentApplicationSkillsResponse struct {
	Skills    []CurrentApplicationSkill `json:"skills"`
	MaxSkills int                       `json:"max_skills"`
}

func (handler *currentApplicationSkillsHandler) list(
	writer http.ResponseWriter,
	request *http.Request,
) {
	projectID, projectOK := currentApplicationSkillsID(chi.URLParam(request, "projectID"))
	appVersionID, versionOK := currentApplicationSkillsID(chi.URLParam(request, "appVersionID"))
	if !projectOK || !versionOK {
		writeCurrentApplicationSkillsFailure(writer)
		return
	}

	skills, err := handler.reader.ListCurrentApplicationSkills(
		request.Context(),
		projectID,
		appVersionID,
	)
	if err != nil {
		writeCurrentApplicationSkillsFailure(writer)
		return
	}

	writeCurrentApplicationSkillsJSON(writer, http.StatusOK, currentApplicationSkillsResponse{
		Skills:    append([]CurrentApplicationSkill{}, skills...),
		MaxSkills: MaxCurrentApplicationSkills,
	})
}

func currentApplicationSkillsProjectID(request *http.Request) (string, bool) {
	projectID, ok := currentApplicationSkillsID(chi.URLParam(request, "projectID"))
	if !ok {
		return "", false
	}
	return strconv.FormatInt(int64(projectID), 10), true
}

func currentApplicationSkillsID(value string) (int32, bool) {
	if value == "" {
		return 0, false
	}
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return 0, false
		}
	}
	parsed, err := strconv.ParseInt(value, 10, 32)
	return int32(parsed), err == nil && parsed > 0
}

func writeCurrentApplicationSkillsFailure(writer http.ResponseWriter) {
	writeCurrentApplicationSkillsJSON(writer, http.StatusBadRequest, map[string]any{
		"ok":    false,
		"error": "Failed to list application skills",
	})
}

func writeCurrentApplicationSkillsJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
