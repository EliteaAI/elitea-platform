package projects

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type Handler struct {
	pool *pgxpool.Pool
}

func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/project/{mode}/{projectID}", h.GetProject)
	r.Get("/project/{mode}", h.AdminProjectList)
	r.Post("/project/{mode}", h.AdminProjectCreate)
	r.Delete("/project/{mode}/{projectID}", h.AdminProjectDelete)
	r.Get("/groups/prompt_lib", h.GroupList)
	r.Put("/groups/prompt_lib/{projectID}", h.PutProjectGroups)
	return r
}

type Project struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Status      string `json:"status"`
	Role        string `json:"role,omitempty"`
	Suspended   bool   `json:"suspended"`
}

type ProjectListResponse struct {
	Items []Project `json:"items"`
	Total int       `json:"total"`
}

func (h *Handler) GetProject(w http.ResponseWriter, r *http.Request) {
	_, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	projectID := chi.URLParam(r, "projectID")
	projectIDNum, _ := strconv.Atoi(projectID)
	ctx := r.Context()

	// Return all projects as a plain array (UI Redux expects numeric IDs)
	rows, err := h.pool.Query(ctx, `SELECT id, name, suspended FROM centry.project ORDER BY id`)
	if err != nil {
		writeJSON(w, http.StatusOK, []Project{{
			ID:     projectIDNum,
			Name:   "Project " + projectID,
			Status: "active",
			Role:   "owner",
		}})
		return
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		var id int
		var name string
		var suspended bool
		if err := rows.Scan(&id, &name, &suspended); err != nil {
			continue
		}
		status := "active"
		if suspended {
			status = "suspended"
		}
		projects = append(projects, Project{
			ID:        id,
			Name:      name,
			Status:    status,
			Role:      "owner",
			Suspended: suspended,
		})
	}

	if len(projects) == 0 {
		projects = []Project{{ID: projectIDNum, Name: "Project " + projectID, Status: "active", Role: "owner"}}
	}

	writeJSON(w, http.StatusOK, projects)
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
		rows.Scan(&g.ID, &g.Name)
		groups = append(groups, g)
	}
	if groups == nil {
		groups = []Group{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": groups, "total": len(groups)})
}

func (h *Handler) PutProjectGroups(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	ctx := r.Context()

	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)

	groupNames, _ := body["groups"].([]any)
	if groupNames == nil {
		writeJSON(w, http.StatusOK, body)
		return
	}

	pid, _ := strconv.Atoi(projectID)

	// Resolve or create groups, collect IDs
	var groupIDs []int
	for _, gn := range groupNames {
		name, ok := gn.(string)
		if !ok || name == "" {
			continue
		}
		var gid int
		err := h.pool.QueryRow(ctx,
			`INSERT INTO centry.project_group (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, name).Scan(&gid)
		if err != nil {
			continue
		}
		groupIDs = append(groupIDs, gid)
	}

	// Delete all existing associations for this project
	h.pool.Exec(ctx, `DELETE FROM centry.project_group_association WHERE project_id = $1`, pid)

	// Insert new associations
	for _, gid := range groupIDs {
		h.pool.Exec(ctx, `INSERT INTO centry.project_group_association (project_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, pid, gid)
	}

	writeJSON(w, http.StatusOK, body)
}

func (h *Handler) AdminProjectList(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := h.pool.Query(ctx, `SELECT id, name, COALESCE(suspended, false) FROM centry.project ORDER BY id`)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}
	defer rows.Close()

	var projects []map[string]any
	for rows.Next() {
		var id int
		var name string
		var suspended bool
		if err := rows.Scan(&id, &name, &suspended); err != nil {
			continue
		}
		projects = append(projects, map[string]any{"id": id, "name": name, "suspended": suspended})
	}
	if projects == nil {
		projects = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": projects, "total": len(projects)})
}

func (h *Handler) AdminProjectCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name              string `json:"name"`
		ProjectAdminEmail string `json:"project_admin_email"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	var id int
	err := h.pool.QueryRow(r.Context(),
		`INSERT INTO centry.project (name) VALUES ($1) RETURNING id`, body.Name).Scan(&id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "name": body.Name})
}

func (h *Handler) AdminProjectDelete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	h.pool.Exec(r.Context(), `DELETE FROM centry.project WHERE id = $1`, projectID)
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
