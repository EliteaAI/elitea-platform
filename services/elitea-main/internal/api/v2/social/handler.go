package social

import (
	"encoding/json"
	"fmt"
	"net/http"

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
	r.Get("/author/", h.GetAuthor)
	r.Get("/author", h.GetAuthor)
	r.Put("/author/", h.UpdateAuthor)
	r.Put("/author", h.UpdateAuthor)
	r.Get("/authors/{projectID}", h.ListAuthors)
	r.Get("/trending_authors/prompt_lib/{projectID}", h.TrendingAuthors)
	r.Post("/like/prompt_lib/{projectID}/application/{applicationID}", h.Like)
	r.Delete("/like/prompt_lib/{projectID}/application/{applicationID}", h.Unlike)
	r.Post("/like/prompt_lib/{projectID}/{entityType}/{entityID}", h.Like)
	r.Delete("/like/prompt_lib/{projectID}/{entityType}/{entityID}", h.Unlike)
	r.Post("/pin/prompt_lib/{projectID}/{entityType}/{entityID}", h.Pin)
	r.Delete("/pin/prompt_lib/{projectID}/{entityType}/{entityID}", h.Unpin)
	r.Get("/feedbacks/default/{projectID}", h.ListFeedbacks)
	r.Post("/feedbacks/default/{projectID}", h.CreateFeedback)
	return r
}

type AuthorResponse struct {
	ID                string  `json:"id"`
	Name              string  `json:"name"`
	Email             string  `json:"email"`
	Avatar            string  `json:"avatar"`
	Description       string  `json:"description"`
	PersonalProjectID string  `json:"personal_project_id"`
	Personalization   any     `json:"personalization,omitempty"`
}

func (h *Handler) GetAuthor(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	if h.pool == nil {
		writeJSON(w, http.StatusOK, AuthorResponse{
			ID:                user.ID,
			Name:              user.Email,
			Email:             user.Email,
			PersonalProjectID: "1",
		})
		return
	}

	ctx := r.Context()

	// Query centry.social_users joined with auth_core__user
	var resp AuthorResponse
	var personalProjectID *int

	err := h.pool.QueryRow(ctx, `
		SELECT
			su.user_id,
			COALESCE(au.name, ''),
			COALESCE(au.email, ''),
			COALESCE(su.avatar, ''),
			COALESCE(su.description, ''),
			p.id,
			su.personalization
		FROM centry.social_users su
		LEFT JOIN auth_core__user au ON au.id = su.user_id
		LEFT JOIN centry.project p ON p.owner_id = su.user_id
		WHERE au.email = $1 OR su.user_id::text = $2
		LIMIT 1
	`, user.Email, user.ID).Scan(
		&resp.ID,
		&resp.Name,
		&resp.Email,
		&resp.Avatar,
		&resp.Description,
		&personalProjectID,
		&resp.Personalization,
	)

	if err != nil {
		// If no row found, create a default response from auth context
		resp = AuthorResponse{
			ID:                user.ID,
			Name:              user.Email,
			Email:             user.Email,
			Avatar:            "",
			Description:       "",
			PersonalProjectID: "1",
		}
	} else {
		if personalProjectID != nil {
			resp.PersonalProjectID = intToStr(*personalProjectID)
		} else {
			resp.PersonalProjectID = "1"
		}
		resp.ID = intToStr(0) // will be overridden below
	}

	// Ensure ID is a string for the UI
	if resp.ID == "0" || resp.ID == "" {
		resp.ID = user.ID
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) UpdateAuthor(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)

	ctx := r.Context()

	// Upsert social_users
	_, err := h.pool.Exec(ctx, `
		INSERT INTO centry.social_users (user_id, title, description, avatar, personalization)
		SELECT au.id, $2, $3, $4, $5
		FROM auth_core__user au WHERE au.email = $1
		ON CONFLICT (user_id) DO UPDATE SET
			title = EXCLUDED.title,
			description = EXCLUDED.description,
			avatar = EXCLUDED.avatar,
			personalization = EXCLUDED.personalization
	`, user.Email,
		strVal(body, "name"),
		strVal(body, "description"),
		strVal(body, "avatar"),
		jsonVal(body, "personalization"),
	)
	if err != nil {
		http.Error(w, `{"error":"failed to update author"}`, http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) ListAuthors(w http.ResponseWriter, r *http.Request) {
	if h.pool == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	ctx := r.Context()
	rows, err := h.pool.Query(ctx, `
		SELECT su.user_id, COALESCE(au.name, ''), COALESCE(au.email, ''), COALESCE(su.avatar, ''), COALESCE(su.description, '')
		FROM centry.social_users su
		LEFT JOIN auth_core__user au ON au.id = su.user_id
		LIMIT 50
	`)
	if err != nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var name, email, avatar, desc string
		rows.Scan(&id, &name, &email, &avatar, &desc)
		items = append(items, map[string]any{
			"id": intToStr(id), "name": name, "email": email,
			"avatar": avatar, "description": desc,
		})
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) TrendingAuthors(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	if h.pool == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	ctx := r.Context()

	rows, err := h.pool.Query(ctx, `
		SELECT su.user_id, COALESCE(au.name, ''), COALESCE(au.email, ''),
			COALESCE(su.avatar, ''), COUNT(sl.id) as like_count
		FROM centry.social_users su
		JOIN auth_core__user au ON au.id = su.user_id
		LEFT JOIN centry.social_likes sl ON sl.user_id = su.user_id AND sl.project_id = $1
		GROUP BY su.user_id, au.name, au.email, su.avatar
		ORDER BY like_count DESC
		LIMIT 10`, projectID)

	items := make([]map[string]any, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int
			var name, email, avatar string
			var likes int
			rows.Scan(&id, &name, &email, &avatar, &likes)
			items = append(items, map[string]any{
				"id": intToStr(id), "name": name, "email": email,
				"avatar": avatar, "likes": likes,
			})
		}
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) Like(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	entityType := chi.URLParam(r, "entityType")
	entityID := chi.URLParam(r, "entityID")
	if entityType == "" {
		entityType = "application"
	}
	if entityID == "" {
		entityID = chi.URLParam(r, "applicationID")
	}
	ctx := r.Context()

	user, ok := auth.UserFromContext(ctx)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	_, err := h.pool.Exec(ctx, `
		INSERT INTO centry.social_likes (entity, user_id, project_id, entity_id, created_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (entity, user_id, project_id, entity_id) DO NOTHING`,
		entityType, user.ID, projectID, entityID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to like"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) Unlike(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	entityType := chi.URLParam(r, "entityType")
	entityID := chi.URLParam(r, "entityID")
	if entityType == "" {
		entityType = "application"
	}
	if entityID == "" {
		entityID = chi.URLParam(r, "applicationID")
	}
	ctx := r.Context()

	user, ok := auth.UserFromContext(ctx)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	h.pool.Exec(ctx, `
		DELETE FROM centry.social_likes
		WHERE entity = $1 AND user_id = $2 AND project_id = $3 AND entity_id = $4`,
		entityType, user.ID, projectID, entityID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) Pin(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	entityType := chi.URLParam(r, "entityType")
	entityID := chi.URLParam(r, "entityID")
	ctx := r.Context()

	user, ok := auth.UserFromContext(ctx)
	if !ok || h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`INSERT INTO %q.social_pins (entity_name, entity_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, s)
	h.pool.Exec(ctx, q, entityType, entityID, user.ID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) Unpin(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	entityType := chi.URLParam(r, "entityType")
	entityID := chi.URLParam(r, "entityID")
	ctx := r.Context()

	user, ok := auth.UserFromContext(ctx)
	if !ok || h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`DELETE FROM %q.social_pins WHERE entity_name = $1 AND entity_id = $2 AND user_id = $3`, s)
	h.pool.Exec(ctx, q, entityType, entityID, user.ID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) ListFeedbacks(w http.ResponseWriter, r *http.Request) {
	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
		return
	}

	projectID := chi.URLParam(r, "projectID")
	ctx := r.Context()

	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`
		SELECT id, entity_name, entity_id, user_id, rating, COALESCE(comment, ''), created_at
		FROM %q.social_feedbacks ORDER BY created_at DESC LIMIT 50`, s)

	rows, err := h.pool.Query(ctx, q)
	items := make([]map[string]any, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int
			var entityName, entityID, userID, comment string
			var rating int
			var createdAt interface{}
			if rows.Scan(&id, &entityName, &entityID, &userID, &rating, &comment, &createdAt) == nil {
				items = append(items, map[string]any{
					"id": intToStr(id), "entity_name": entityName, "entity_id": entityID,
					"user_id": userID, "rating": rating, "comment": comment, "created_at": createdAt,
				})
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) CreateFeedback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	user, ok := auth.UserFromContext(ctx)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": "0"})
		return
	}

	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": "0"})
		return
	}

	projectID := chi.URLParam(r, "projectID")

	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)

	entityName, _ := body["entity_name"].(string)
	entityID, _ := body["entity_id"].(string)
	rating := 0
	if r, ok := body["rating"].(float64); ok {
		rating = int(r)
	}
	comment, _ := body["comment"].(string)

	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`
		INSERT INTO %q.social_feedbacks (entity_name, entity_id, user_id, rating, comment, created_at)
		VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`, s)

	var id int
	err := h.pool.QueryRow(ctx, q, entityName, entityID, user.ID, rating, comment).Scan(&id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to create feedback"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "id": intToStr(id)})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func intToStr(i int) string {
	return fmt.Sprintf("%d", i)
}

func strVal(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func jsonVal(m map[string]any, key string) []byte {
	if v, ok := m[key]; ok {
		b, _ := json.Marshal(v)
		return b
	}
	return []byte("null")
}
