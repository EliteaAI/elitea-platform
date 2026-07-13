package scheduling

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	pool *pgxpool.Pool
}

func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

type scheduleItem struct {
	ID              int64  `json:"id"`
	ApplicationID   int64  `json:"application_id"`
	ApplicationName string `json:"application_name"`
	VersionName     string `json:"version_name"`
	Schedule        string `json:"schedule"`
	Enabled         bool   `json:"enabled"`
	Type            string `json:"type"`
}

func (h *Handler) Schedules(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	w.Header().Set("Content-Type", "application/json")

	if h.pool == nil || projectID == "" || projectID == "0" {
		json.NewEncoder(w).Encode(map[string]any{"items": []any{}, "total": 0})
		return
	}

	ctx := r.Context()
	schema := fmt.Sprintf("p_%s", projectID)

	// pipeline_settings stores pipeline graph data (nodes/edges).
	// Trigger/schedule config may be stored in meta->'trigger' on some deployments.
	q := fmt.Sprintf(`
		SELECT av.id, av.application_id, a.name AS app_name, av.name AS version_name, av.meta
		FROM %q.application_versions av
		JOIN %q.applications a ON a.id = av.application_id
		WHERE av.meta IS NOT NULL AND av.meta->'trigger' IS NOT NULL
		  AND av.meta->'trigger'->>'enabled' = 'true'
		ORDER BY av.id`, schema, schema)

	rows, err := h.pool.Query(ctx, q)
	if err != nil {
		// Column may not exist or table may be missing — return empty
		json.NewEncoder(w).Encode(map[string]any{"items": []any{}, "total": 0})
		return
	}
	defer rows.Close()

	items := make([]scheduleItem, 0)
	for rows.Next() {
		var item scheduleItem
		var metaRaw []byte
		if err := rows.Scan(&item.ID, &item.ApplicationID, &item.ApplicationName, &item.VersionName, &metaRaw); err != nil {
			continue
		}

		var meta map[string]any
		if err := json.Unmarshal(metaRaw, &meta); err == nil {
			if trigger, ok := meta["trigger"].(map[string]any); ok {
				if s, ok := trigger["schedule"].(string); ok {
					item.Schedule = s
				}
				if t, ok := trigger["type"].(string); ok {
					item.Type = t
				}
			}
		}
		item.Enabled = true

		items = append(items, item)
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"items": items,
		"total": len(items),
	})
}
