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
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	writeJSON(w, http.StatusOK, body)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
