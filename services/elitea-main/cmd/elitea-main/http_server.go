package main

import (
	"net/http"
	"time"
)

// newHTTPServer builds the production *http.Server. S12 replaces the global
// ReadTimeout/WriteTimeout with ReadHeaderTimeout: those two bound reading
// and writing the ENTIRE request/response, including the body, which made
// them a hard ceiling on every upload (10s) and download (120s) regardless
// of size — S9 made the download route live and S12 adds a per-object size
// limit, so a fixed wall-clock body ceiling no longer makes sense.
// ReadHeaderTimeout alone still bounds the slow-header-only attack
// ReadTimeout was also guarding against. Per-request body deadlines are set
// by the artifact upload/download handlers instead
// (internal/api/v2/artifacts/objects.go, http.ResponseController).
func newHTTPServer(addr string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}
