package folders

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type Folder struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"project_id"`
	Name      string    `json:"name"`
	ParentID  string    `json:"parent_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Repository interface {
	List(ctx context.Context, projectID string) ([]Folder, error)
	Create(ctx context.Context, projectID string, folder Folder) (Folder, error)
	Update(ctx context.Context, projectID, folderID string, folder Folder) (Folder, error)
	Delete(ctx context.Context, projectID, folderID string) error
}

type Handler struct {
	repo Repository
	pool *pgxpool.Pool
}

func NewHandler(repo Repository) *Handler {
	return &Handler{repo: repo}
}

func (h *Handler) WithPool(pool *pgxpool.Pool) *Handler {
	h.pool = pool
	return h
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Put("/{folderID}", h.Update)
	r.Patch("/{folderID}", h.Update)
	r.Delete("/{folderID}", h.Delete)
	return r
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	grouped := r.URL.Query().Get("grouped") == "true"

	if !grouped {
		folders, err := h.repo.List(r.Context(), projectID)
		if err != nil {
			apierr.Write(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": folders})
		return
	}

	h.listGrouped(w, r, projectID)
}

type conversationItem struct {
	ID        int        `json:"id"`
	Name      string     `json:"name"`
	UUID      string     `json:"uuid,omitempty"`
	AuthorID  int        `json:"author_id"`
	FolderID  *int       `json:"folder_id"`
	IsPinned  bool       `json:"is_pinned,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt *time.Time `json:"updated_at"`
}

type dateGroup struct {
	Name          string             `json:"name"`
	Conversations []conversationItem `json:"conversations"`
	Total         int                `json:"total"`
	Offset        int                `json:"offset"`
}

func (h *Handler) listGrouped(w http.ResponseWriter, r *http.Request, projectID string) {
	ctx := r.Context()
	schema := fmt.Sprintf("p_%s", projectID)

	var userID string
	if u, ok := auth.UserFromContext(ctx); ok {
		userID = u.ID
	}

	sortBy := r.URL.Query().Get("sort_by")
	if sortBy == "" {
		sortBy = "updated_at"
	}
	sortOrder := r.URL.Query().Get("sort_order")
	if sortOrder == "" {
		sortOrder = "desc"
	}

	orderCol := "c.updated_at"
	switch sortBy {
	case "created_at":
		orderCol = "c.created_at"
	case "name":
		orderCol = "c.name"
	}
	orderDir := "DESC"
	if sortOrder == "asc" {
		orderDir = "ASC"
	}

	// Query conversations (indexes on conversation_id ensure fast joins elsewhere)
	q := fmt.Sprintf(`
		SELECT c.id, c.name, COALESCE(c.uuid::text, ''), c.author_id, c.folder_id,
		       COALESCE((c.meta->>'is_pinned')::boolean, false) as is_pinned,
		       c.created_at, c.updated_at
		FROM %q.chat_conversations c
		WHERE (c.meta->>'is_hidden' IS NULL OR c.meta->>'is_hidden' = 'false')
		ORDER BY %s %s`, schema, orderCol, orderDir)

	conversations := make([]conversationItem, 0)
	if h.pool != nil {
		rows, err := h.pool.Query(ctx, q)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var c conversationItem
				var updatedAt *time.Time
				if err := rows.Scan(&c.ID, &c.Name, &c.UUID, &c.AuthorID, &c.FolderID, &c.IsPinned, &c.CreatedAt, &updatedAt); err != nil {
					continue
				}
				c.UpdatedAt = updatedAt
				conversations = append(conversations, c)
			}
		}
	}

	// Query search filter
	searchQuery := r.URL.Query().Get("query")
	if searchQuery != "" {
		filtered := make([]conversationItem, 0)
		for _, c := range conversations {
			if containsInsensitive(c.Name, searchQuery) {
				filtered = append(filtered, c)
			}
		}
		conversations = filtered
	}

	// Separate pinned, foldered, and ungrouped
	pinned := make([]conversationItem, 0)
	foldered := make(map[int][]conversationItem)
	ungrouped := make([]conversationItem, 0)

	for _, c := range conversations {
		if c.IsPinned {
			pinned = append(pinned, c)
		} else if c.FolderID != nil {
			foldered[*c.FolderID] = append(foldered[*c.FolderID], c)
		} else {
			ungrouped = append(ungrouped, c)
		}
	}

	// Build date groups from ungrouped conversations
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	yesterday := today.AddDate(0, 0, -1)
	weekAgo := today.AddDate(0, 0, -7)
	monthAgo := today.AddDate(0, -1, 0)

	groups := map[string][]conversationItem{
		"Today":      {},
		"Yesterday":  {},
		"This week":  {},
		"This month": {},
		"Older":      {},
	}
	groupOrder := []string{"Today", "Yesterday", "This week", "This month", "Older"}

	for _, c := range ungrouped {
		ts := c.CreatedAt
		if c.UpdatedAt != nil {
			ts = *c.UpdatedAt
		}
		switch {
		case !ts.Before(today):
			groups["Today"] = append(groups["Today"], c)
		case !ts.Before(yesterday):
			groups["Yesterday"] = append(groups["Yesterday"], c)
		case !ts.Before(weekAgo):
			groups["This week"] = append(groups["This week"], c)
		case !ts.Before(monthAgo):
			groups["This month"] = append(groups["This month"], c)
		default:
			groups["Older"] = append(groups["Older"], c)
		}
	}

	dateGroups := make([]dateGroup, 0)
	for _, label := range groupOrder {
		convs := groups[label]
		if len(convs) > 0 {
			dateGroups = append(dateGroups, dateGroup{
				Name:          label,
				Conversations: convs,
				Total:         len(convs),
				Offset:        len(convs),
			})
		}
	}

	// Build folders with conversations
	folders, _ := h.repo.List(ctx, projectID)
	foldersResponse := make([]map[string]any, 0, len(folders))
	for _, f := range folders {
		fID := 0
		_, _ = fmt.Sscanf(f.ID, "%d", &fID)
		convs := foldered[fID]
		if convs == nil {
			convs = []conversationItem{}
		}
		foldersResponse = append(foldersResponse, map[string]any{
			"id":            f.ID,
			"name":          f.Name,
			"project_id":    f.ProjectID,
			"created_at":    f.CreatedAt,
			"updated_at":    f.UpdatedAt,
			"conversations": convs,
			"total":         len(convs),
			"offset":        len(convs),
		})
	}

	// Get selected conversation for this user
	var selectedConvID *int
	if h.pool != nil && userID != "" {
		selQ := fmt.Sprintf(`SELECT conversation_id FROM %q.chat_selected_conversations WHERE user_id = $1 LIMIT 1`, schema)
		var selID int
		if err := h.pool.QueryRow(ctx, selQ, userID).Scan(&selID); err == nil {
			selectedConvID = &selID
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"date_groups":              dateGroups,
		"folders":                  foldersResponse,
		"pinned":                   map[string]any{"conversations": pinned},
		"selected_conversation_id": selectedConvID,
		"total_folders":            len(folders),
	})
}

func containsInsensitive(s, substr string) bool {
	sl := len(substr)
	if sl == 0 {
		return true
	}
	for i := 0; i <= len(s)-sl; i++ {
		if eqFoldByte(s[i:i+sl], substr) {
			return true
		}
	}
	return false
}

func eqFoldByte(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		ca, cb := a[i], b[i]
		if ca >= 'A' && ca <= 'Z' {
			ca += 32
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 32
		}
		if ca != cb {
			return false
		}
	}
	return true
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	folders, err := h.repo.List(r.Context(), projectID)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	folderID := chi.URLParam(r, "folderID")
	for _, f := range folders {
		if f.ID == folderID {
			writeJSON(w, http.StatusOK, f)
			return
		}
	}
	apierr.Write(w, apierr.NotFound("folder not found"))
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var folder Folder
	if err := json.NewDecoder(r.Body).Decode(&folder); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	created, err := h.repo.Create(r.Context(), projectID, folder)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	folderID := chi.URLParam(r, "folderID")

	// PATCH: partial merge — fetch existing folder, apply only provided fields.
	if r.Method == http.MethodPatch {
		folders, err := h.repo.List(r.Context(), projectID)
		if err != nil {
			apierr.Write(w, err)
			return
		}
		var existing *Folder
		for i := range folders {
			if folders[i].ID == folderID {
				existing = &folders[i]
				break
			}
		}
		if existing == nil {
			apierr.Write(w, apierr.NotFound("folder not found"))
			return
		}

		var patch map[string]any
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			apierr.Write(w, apierr.BadRequest("invalid request body"))
			return
		}
		if name, ok := patch["name"].(string); ok {
			existing.Name = name
		}
		if parentID, ok := patch["parent_id"].(string); ok {
			existing.ParentID = parentID
		}

		updated, err := h.repo.Update(r.Context(), projectID, folderID, *existing)
		if err != nil {
			apierr.Write(w, err)
			return
		}
		writeJSON(w, http.StatusOK, updated)
		return
	}

	// PUT: full replacement.
	var folder Folder
	if err := json.NewDecoder(r.Body).Decode(&folder); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	updated, err := h.repo.Update(r.Context(), projectID, folderID, folder)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	folderID := chi.URLParam(r, "folderID")

	if err := h.repo.Delete(r.Context(), projectID, folderID); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
