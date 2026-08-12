package projects

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
)

type Handler struct {
	pool     *pgxpool.Pool
	projects CurrentProjectLister
	resolver auth.PermissionResolver
}

// Option configures a Handler at construction time.
type Option func(*Handler)

// WithPermissionResolver supplies the resolver the group WRITE routes are gated
// on. It is an Option rather than middleware applied in router.go because this
// package is Mount()ed as a subrouter, and chi cannot carry a per-route gate
// across a mount boundary.
//
// Fail-closed: `RequireResolvedPermissionsForProject` answers 403 when its
// resolver is nil, so a Handler built without this option serves the reads and
// refuses every write rather than running ungated.
func WithPermissionResolver(resolver auth.PermissionResolver) Option {
	return func(h *Handler) { h.resolver = resolver }
}

const (
	CurrentProjectListPath       = "/api/v2/projects/project/default/1"
	CurrentProjectListMode       = auth.PermissionModeDefault
	CurrentProjectListProjectID  = "1"
	CurrentProjectListPermission = "projects.projects.project.view"
)

func NewHandler(pool *pgxpool.Pool, options ...Option) *Handler {
	var projects CurrentProjectLister
	if pool != nil {
		projects = sqlcgen.New(pool)
	}
	handler := &Handler{pool: pool, projects: projects}
	for _, option := range options {
		option(handler)
	}
	return handler
}

// CurrentProjectLister is the generated query surface consumed by the one
// current-compatible project-list route. Keeping this interface at the
// consumer makes the HTTP contract testable without replacing PostgreSQL in
// production.
type CurrentProjectLister interface {
	ListCurrentUserProjects(context.Context, sqlcgen.ListCurrentUserProjectsParams) ([]sqlcgen.ListCurrentUserProjectsRow, error)
}

func NewCurrentProjectListHandler(projects CurrentProjectLister) *Handler {
	return &Handler{projects: projects}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/project/{mode}/{projectID}", h.GetProject)
	r.Get("/groups/prompt_lib", h.GroupList)
	// The three group WRITES, gated on the permissions their pylon originals
	// declare — `projects.projects.groups.edit` for the set-replacement PUT
	// (groups.py) and `projects.projects.group.create` / `.delete` for the
	// singular create and detach (group.py). Resolved in DEFAULT mode against
	// the project in the path, which is the mode pylon's `recommended_roles`
	// names for these handlers and the one the `prompt_lib` segment reaches.
	r.With(h.requireProjectPermission("projects.projects.groups.edit")).
		Put("/groups/prompt_lib/{projectID}", h.PutProjectGroups)
	r.With(h.requireProjectPermission("projects.projects.group.create")).
		Post("/group/prompt_lib/{projectID}", h.GroupCreate)
	r.With(h.requireProjectPermission("projects.projects.group.delete")).
		Delete("/group/prompt_lib/{projectID}/{groupID}", h.GroupDelete)
	return r
}

func (h *Handler) requireProjectPermission(permission string) func(http.Handler) http.Handler {
	return apimw.RequireResolvedPermissions(h.resolver, auth.PermissionModeDefault, permission)
}

type Project struct {
	ID             int32           `json:"id"`
	Name           string          `json:"name"`
	OwnerID        int32           `json:"owner_id"`
	Plugins        []string        `json:"plugins"`
	KeycloakGroups json.RawMessage `json:"keycloak_groups"`
	CreateSuccess  bool            `json:"create_success"`
	Suspended      bool            `json:"suspended"`
	Groups         []Group         `json:"groups"`
}

func (h *Handler) GetProject(w http.ResponseWriter, r *http.Request) {
	publicProjectID, err := parseInt32(chi.URLParam(r, "projectID"))
	if err != nil || publicProjectID <= 0 {
		http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
		return
	}
	h.getCurrentProjects(w, r, publicProjectID)
}

// GetCurrentProjectList owns only the exact route used by the current UI. The
// public-project identifier is part of that compatibility contract, not a
// caller-selected tenant scope.
func (h *Handler) GetCurrentProjectList(w http.ResponseWriter, r *http.Request) {
	h.getCurrentProjects(w, r, 1)
}

func (h *Handler) getCurrentProjects(w http.ResponseWriter, r *http.Request, publicProjectID int32) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	userID, ok := user.OwningUserID()
	if !ok || userID > int64(^uint32(0)>>1) {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	if h.projects == nil {
		http.Error(w, `{"error":"service unavailable"}`, http.StatusServiceUnavailable)
		return
	}

	limit, err := optionalInt32(r, "limit")
	if err != nil {
		http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
		return
	}
	offset, err := optionalInt32(r, "offset")
	if err != nil {
		http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
		return
	}

	var search *string
	if value := r.URL.Query().Get("search"); value != "" {
		search = &value
	}
	checkPublicRole := r.URL.Query().Get("check_public_role") != ""
	rows, err := h.projects.ListCurrentUserProjects(r.Context(), sqlcgen.ListCurrentUserProjectsParams{
		CheckPublicRole: checkPublicRole,
		PublicProjectID: publicProjectID,
		UserID:          int32(userID),
		Search:          search,
		Offset:          offset,
		Limit:           limit,
	})
	if err != nil {
		http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
		return
	}

	projects := assembleProjects(rows)
	writeJSON(w, http.StatusOK, projects)
}

func optionalInt32(r *http.Request, name string) (*int32, error) {
	values, present := r.URL.Query()[name]
	if !present {
		return nil, nil
	}
	value, err := parseInt32(values[0])
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func parseInt32(value string) (int32, error) {
	parsed, err := strconv.ParseInt(value, 10, 32)
	return int32(parsed), err
}

func assembleProjects(rows []sqlcgen.ListCurrentUserProjectsRow) []Project {
	projects := make([]Project, 0)
	for _, row := range rows {
		if len(projects) == 0 || projects[len(projects)-1].ID != row.ID {
			projects = append(projects, Project{
				ID:             row.ID,
				Name:           row.Name,
				OwnerID:        row.OwnerID,
				Plugins:        row.Plugins,
				KeycloakGroups: json.RawMessage(row.KeycloakGroups),
				CreateSuccess:  row.CreateSuccess,
				Suspended:      row.Suspended,
				Groups:         make([]Group, 0),
			})
		}
		if row.GroupID == nil || row.GroupName == nil {
			continue
		}
		project := &projects[len(projects)-1]
		if len(project.Groups) != 0 && project.Groups[len(project.Groups)-1].ID == int(*row.GroupID) {
			continue
		}
		project.Groups = append(project.Groups, Group{ID: int(*row.GroupID), Name: *row.GroupName})
	}
	return projects
}

type Group struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

func (h *Handler) GroupList(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := h.pool.Query(ctx, `SELECT id, name FROM centry.project_group ORDER BY id`)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
		return
	}
	defer rows.Close()

	var groups []Group
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.ID, &g.Name); err != nil {
			http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
			return
		}
		groups = append(groups, g)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
		return
	}
	if groups == nil {
		groups = []Group{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": groups, "total": len(groups)})
}

// PutProjectGroups, GroupCreate and GroupDelete live in groups.go. The PUT used
// to sit here as a body echo: it decoded the request and wrote it back as the
// response without touching a table, so every group edit reported success and
// changed nothing.

func writeJSON(w http.ResponseWriter, code int, v any) {
	payload, err := json.Marshal(v)
	if err != nil {
		http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
		return
	}
	payload = append(payload, '\n')
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if _, err := w.Write(payload); err != nil {
		return
	}
}
