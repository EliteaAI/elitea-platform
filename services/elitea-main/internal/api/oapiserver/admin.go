package oapiserver

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/generated"
)

func (s *Server) ModerationStatus(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, entityId int) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "approved", "entity_id": entityId})
}

func (s *Server) CreateModerationRequest(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, entityId int) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "approved", "entity_id": entityId})
}

func (s *Server) RoleList(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.RoleListParams) {
	if s.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": defaultRoles(), "total": len(defaultRoles())})
		return
	}

	ctx := r.Context()
	pid, _ := strconv.Atoi(projectId)

	rows, err := s.pool.Query(ctx,
		`SELECT id, name FROM auth_core__project_role WHERE project_id = $1 ORDER BY id`, pid)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": defaultRoles(), "total": len(defaultRoles())})
		return
	}
	defer rows.Close()

	type role struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	}
	var roles []role
	for rows.Next() {
		var r role
		if err := rows.Scan(&r.ID, &r.Name); err != nil {
			continue
		}
		roles = append(roles, r)
	}
	if len(roles) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"items": defaultRoles(), "total": len(defaultRoles())})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": roles, "total": len(roles)})
}

func (s *Server) UserList(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.UserListParams) {
	if s.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}

	ctx := r.Context()
	pid, _ := strconv.Atoi(projectId)

	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.email, COALESCE(u.name, ''), r.name as role_name
		FROM auth_core__user u
		JOIN auth_core__project_user_role pur ON pur.user_id = u.id
		JOIN auth_core__project_role r ON r.id = pur.role_id
		WHERE pur.project_id = $1
		ORDER BY u.id`, pid)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}
	defer rows.Close()

	var users []map[string]any
	for rows.Next() {
		var id int
		var email, name, roleName string
		if err := rows.Scan(&id, &email, &name, &roleName); err != nil {
			continue
		}
		users = append(users, map[string]any{
			"id": id, "email": email, "name": name, "role": roleName,
		})
	}
	if users == nil {
		users = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": users, "total": len(users)})
}

// NOTE(#130): this file is NOT what serves /api/v2/admin/users — the generated
// server in this package is never mounted (see conformance_test.go), and the
// chi router sends every users verb to internal/api/v2/eliteacore. The original
// #130 report blamed the `{user_id, role_id}` decoding below for the dead
// invite path; that diagnosis was wrong and is corrected in the issue's
// comments. The live contract is `{emails, roles}` / `{userId, roles}` and is
// implemented in eliteacore/users_write.go. Anything changed here changes
// nothing a client can observe.
func (s *Server) UserCreate(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.pool == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	var body struct {
		UserID int `json:"user_id"`
		RoleID int `json:"role_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	ctx := r.Context()
	pid, _ := strconv.Atoi(projectId)

	_, err := s.pool.Exec(ctx,
		`INSERT INTO auth_core__project_user_role (user_id, role_id, project_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
		body.UserID, body.RoleID, pid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to assign user"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true})
}

func (s *Server) UserUpdate(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.pool == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	var body struct {
		UserID int `json:"user_id"`
		RoleID int `json:"role_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	ctx := r.Context()
	pid, _ := strconv.Atoi(projectId)

	_, err := s.pool.Exec(ctx,
		`UPDATE auth_core__project_user_role SET role_id = $1 WHERE user_id = $2 AND project_id = $3`,
		body.RoleID, body.UserID, pid)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to update user role"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) UserDelete(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.UserDeleteParams) {
	if s.pool == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()
	pid, _ := strconv.Atoi(projectId)

	// NOTE(W2): the spec parameter was aligned to the old SPA's repeated
	// ?id[]= key (parity manifest API-084), so params.Id is now *[]int.
	// Mechanical update: same single-id semantics, applied per id.
	if params.Id == nil || len(*params.Id) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "user_id required"})
		return
	}

	for _, id := range *params.Id {
		_, err := s.pool.Exec(ctx,
			`DELETE FROM auth_core__project_user_role WHERE user_id = $1 AND project_id = $2`,
			id, pid)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to remove user"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func defaultRoles() []map[string]any {
	return []map[string]any{
		{"id": 1, "name": "admin"},
		{"id": 2, "name": "editor"},
		{"id": 3, "name": "viewer"},
	}
}
