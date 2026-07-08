package health

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Status represents the health check response body.
type Status struct {
	Status string `json:"status"`
}

// Routes returns a chi.Router with the three health probe endpoints.
func Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/healthz", livenessHandler)
	r.Get("/readyz", readinessHandler)
	r.Get("/startupz", startupHandler)
	return r
}

// livenessHandler signals that the process is alive.
func livenessHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, Status{Status: "ok"})
}

// readinessHandler signals that the service is ready to accept traffic.
// TODO: add DB/Redis connectivity checks.
func readinessHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, Status{Status: "ready"})
}

// startupHandler signals that the service has completed startup.
func startupHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, Status{Status: "started"})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
