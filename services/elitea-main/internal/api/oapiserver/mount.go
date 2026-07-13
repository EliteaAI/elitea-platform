package oapiserver

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/generated"
)

func Mount(r chi.Router, srv *Server, baseURL string) {
	generated.HandlerFromMuxWithBaseURL(srv, r, baseURL)
}

func Handler(srv *Server, baseURL string) http.Handler {
	return generated.HandlerWithOptions(srv, generated.ChiServerOptions{
		BaseURL: baseURL,
	})
}
