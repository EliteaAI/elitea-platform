package health

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler serves the /healthz endpoint.
type Handler struct {
	pool *pgxpool.Pool
}

// New creates a health check Handler.
func New(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := h.pool.Ping(r.Context()); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		w.Write([]byte("db unreachable"))
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}
