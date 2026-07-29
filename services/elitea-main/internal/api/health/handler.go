package health

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type Status struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks,omitempty"`
}

type Checker interface {
	Ping(ctx context.Context) error
}

type Deps struct {
	DB    Checker
	Redis Checker
}

func Routes() chi.Router {
	return RoutesWithDeps(Deps{})
}

func RoutesWithDeps(deps Deps) chi.Router {
	r := chi.NewRouter()
	r.Get("/healthz", livenessHandler)
	r.Get("/readyz", readinessHandler(deps))
	r.Get("/startupz", startupHandler)
	return r
}

func livenessHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, Status{Status: "ok"})
}

func readinessHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		checks := make(map[string]string)
		allOK := true

		if deps.DB != nil {
			if err := deps.DB.Ping(ctx); err != nil {
				checks["db"] = "unavailable"
				allOK = false
			} else {
				checks["db"] = "ok"
			}
		}

		if deps.Redis != nil {
			if err := deps.Redis.Ping(ctx); err != nil {
				checks["redis"] = "unavailable"
				allOK = false
			} else {
				checks["redis"] = "ok"
			}
		}

		if !allOK {
			writeJSON(w, http.StatusServiceUnavailable, Status{Status: "not_ready", Checks: checks})
			return
		}

		writeJSON(w, http.StatusOK, Status{Status: "ready", Checks: checks})
	}
}

func startupHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, Status{Status: "started"})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
