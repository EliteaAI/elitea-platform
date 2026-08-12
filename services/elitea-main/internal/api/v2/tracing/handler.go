// Package tracing serves the Go successor to the legacy tracing plugin's
// ingest surface (legacy/plugins/tracing/api/v2/{collect,otlp,status}.py):
//
//   - `status` reports whether this deployment exports OpenTelemetry traces —
//     the Go equivalent of models/admin.tracing.view + models.monitoring.
//     tracing.view.
//   - `otlp` reverse-proxies browser-originated OTLP/HTTP payloads to the
//     configured collector, avoiding a browser-to-collector CORS hop exactly
//     as the pylon original did against Jaeger (legacy otlp.py).
//   - `collect` accepts the UI's own span-batch shape (legacy collect.py) and
//     re-emits it as real spans through the process-wide TracerProvider —
//     the same one libs/go/observability wires up for elitea-main's own
//     instrumentation, so UI spans and server spans land in one collector.
//
// # Architecture decision (issue #250)
//
// Option (a) of the two the issue offers: elitea-main proxies collect/otlp to
// an OTEL collector rather than pointing clients straight at a collector
// service. This is a straight port of the legacy shape (both collect.py and
// otlp.py already proxy through pylon_main), keeps the UI/worker client
// surface unchanged, and needs no collector-facing CORS or authentication
// configuration in deploy/* — the collector only ever talks to elitea-main.
//
// # Authorization
//
// collect/otlp use apimw.RequireProjectAccess, the same project-membership
// gate internal/api/v2/social uses for its own plugin surface — telemetry
// ingestion is not sensitive enough to warrant a dedicated permission grant,
// and adding one would need a new seeded migration (the admin-rbac-seeding
// pattern .../migrations/shared/0062_budgets_quota_statistics.sql follows)
// for a surface with no data-exposure risk. The `status/administration` read
// reuses the already-seeded "runtime.plugins" central permission — the same
// gate router.go applies to the other admin runtime/plugin status reads
// (system_info.py, plugin_config_*.py, maintenance.py, runtime_*.py) — rather
// than seeding the legacy "models.admin.tracing.view" permission fresh.
package tracing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

// Config configures the tracing ingest surface.
type Config struct {
	// Enabled mirrors the observability SDK's own kill switch
	// (OTEL_SDK_DISABLED != "true"): with nothing behind it to export to,
	// ingest answers a discoverable "tracing is disabled" (503, matching
	// legacy's `if not self.module.enabled` branches) instead of silently
	// accepting and dropping every payload.
	Enabled bool
	// CollectorHTTPEndpoint is the OTLP/HTTP collector base URL `otlp`
	// forwards to, e.g. "http://otel-collector:4318". Read from
	// OTEL_EXPORTER_OTLP_ENDPOINT — the same env var libs/go/observability
	// reads for elitea-main's own span export, so both paths point at one
	// collector by construction.
	CollectorHTTPEndpoint string
	ServiceName           string
}

// ConfigFromEnv reads the same OTEL_SDK_DISABLED / OTEL_EXPORTER_OTLP_ENDPOINT
// variables libs/go/observability.ConfigFromEnv reads, so a single pair of
// env vars controls both elitea-main's own span export and this ingest
// surface's target collector.
func ConfigFromEnv(serviceName string) Config {
	return Config{
		Enabled:               os.Getenv("OTEL_SDK_DISABLED") != "true",
		CollectorHTTPEndpoint: envOr("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318"),
		ServiceName:           serviceName,
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// Handler serves collect/otlp/status. tracer is a func rather than a stored
// trace.Tracer so tests can swap in noop.Tracer{} without depending on the
// global TracerProvider observability.New installs at process startup.
type Handler struct {
	cfg    Config
	pool   *pgxpool.Pool
	tracer func() trace.Tracer
	client *http.Client
}

func NewHandler(pool *pgxpool.Pool, cfg Config, tracer func() trace.Tracer) *Handler {
	return &Handler{
		cfg:    cfg,
		pool:   pool,
		tracer: tracer,
		client: &http.Client{Timeout: 5 * time.Second},
	}
}

// Routes mounts collect/otlp (project-access gated, legacy DEFAULT mode) and
// status (both prompt_lib and administration modes). requireAdminStatus is
// injected by router.go so this package does not need its own
// PermissionResolver wiring — see the "runtime.plugins" note in the package
// doc comment.
func (h *Handler) Routes(requireAdminStatus func(http.Handler) http.Handler) chi.Router {
	r := chi.NewRouter()

	// No-project-id variant: legacy's url_params included a bare '' alongside
	// '<int:project_id>' (PromptLibAPI.post(self, project_id: int = None,
	// **kwargs)) for callers that have not resolved a project yet (e.g. the
	// UI's earliest boot-time spans). Authenticated only — there is no
	// project to check membership against.
	r.Group(func(r chi.Router) {
		r.Use(requireAuthenticatedUser)
		r.Post("/collect/prompt_lib", h.Collect)
		r.Post("/otlp/prompt_lib", h.OTLP)
	})

	r.Group(func(r chi.Router) {
		r.Use(apimw.RequireProjectAccess(h.pool))
		r.Post("/collect/prompt_lib/{projectID}", h.Collect)
		r.Post("/otlp/prompt_lib/{projectID}", h.OTLP)
		r.Get("/status/prompt_lib/{projectID}", h.StatusProject)
	})

	r.Group(func(r chi.Router) {
		r.Use(requireAdminStatus)
		r.Get("/status/administration", h.StatusAdmin)
	})

	return r
}

func requireAuthenticatedUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := auth.UserFromContext(r.Context()); !ok {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- collect -----------------------------------------------------------

type collectRequest struct {
	Traces []traceBatch `json:"traces"`
}

type traceBatch struct {
	TraceID  string         `json:"trace_id"`
	Name     string         `json:"name"`
	Metadata map[string]any `json:"metadata"`
	Spans    []spanData     `json:"spans"`
}

type spanData struct {
	Name       string         `json:"name"`
	Metadata   map[string]any `json:"metadata"`
	DurationMs *float64       `json:"duration_ms"`
}

// Collect accepts a batch of UI/worker-reported spans and re-emits them as
// real OTel spans through the process TracerProvider — the Go equivalent of
// legacy collect.py's `tracer.start_as_current_span` loop.
func (h *Handler) Collect(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.Enabled {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "Tracing is disabled", "received": 0})
		return
	}

	var body collectRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "No data provided", "received": 0})
		return
	}

	projectID := chi.URLParam(r, "projectID")
	user, _ := auth.UserFromContext(r.Context())
	ctx := r.Context()
	tracer := h.tracer()

	spansCreated := 0
	for _, tb := range body.Traces {
		effectiveProjectID := projectID
		if effectiveProjectID == "" {
			if v, ok := tb.Metadata["project_id"]; ok {
				effectiveProjectID = fmt.Sprintf("%v", v)
			}
		}

		attrs := []attribute.KeyValue{
			attribute.String("trace.source", "ui"),
			attribute.String("trace.id", tb.TraceID),
			attribute.String("project.id", effectiveProjectID),
			attribute.String("user.id", user.ID),
		}
		attrs = append(attrs, metadataAttrs(tb.Metadata)...)

		_, parentSpan := tracer.Start(ctx, "ui:"+tb.Name, trace.WithAttributes(attrs...))
		spansCreated++

		for _, sd := range tb.Spans {
			childAttrs := []attribute.KeyValue{attribute.String("span.source", "ui")}
			if sd.DurationMs != nil {
				childAttrs = append(childAttrs, attribute.Float64("duration_ms", *sd.DurationMs))
			}
			childAttrs = append(childAttrs, metadataAttrs(sd.Metadata)...)

			_, childSpan := tracer.Start(ctx, sd.Name, trace.WithAttributes(childAttrs...))
			spansCreated++
			if errMsg, ok := sd.Metadata["error"]; ok && errMsg != nil && errMsg != "" {
				childSpan.SetStatus(codes.Error, fmt.Sprintf("%v", errMsg))
			} else {
				childSpan.SetStatus(codes.Ok, "")
			}
			childSpan.End()
		}
		parentSpan.End()
	}

	writeJSON(w, http.StatusOK, map[string]any{"received": len(body.Traces), "spans_created": spansCreated})
}

func metadataAttrs(metadata map[string]any) []attribute.KeyValue {
	attrs := make([]attribute.KeyValue, 0, len(metadata))
	for k, v := range metadata {
		if v == nil {
			continue
		}
		attrs = append(attrs, attribute.String("ui."+k, fmt.Sprintf("%v", v)))
	}
	return attrs
}

// --- otlp --------------------------------------------------------------

// OTLP reverse-proxies the raw OTLP/HTTP payload to the configured collector,
// exactly as legacy otlp.py proxied to Jaeger — same error-status mapping
// (connection refused -> 503, timeout -> 504, anything else -> 500).
func (h *Handler) OTLP(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.Enabled {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "Tracing is disabled"})
		return
	}

	target := h.cfg.CollectorHTTPEndpoint + "/v1/traces"
	contentType := r.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}

	proxyReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, target, r.Body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "Internal error"})
		return
	}
	proxyReq.Header.Set("Content-Type", contentType)

	resp, err := h.client.Do(proxyReq)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || isTimeout(err) {
			writeJSON(w, http.StatusGatewayTimeout, map[string]any{"error": "OTLP endpoint timeout"})
			return
		}
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "OTLP endpoint unavailable"})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	respContentType := resp.Header.Get("Content-Type")
	if respContentType == "" {
		respContentType = "application/json"
	}
	w.Header().Set("Content-Type", respContentType)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func isTimeout(err error) bool {
	type timeoutError interface{ Timeout() bool }
	var te timeoutError
	return errors.As(err, &te) && te.Timeout()
}

// --- status --------------------------------------------------------------

// StatusProject serves GET /tracing/status/prompt_lib/{projectID} — the
// project-scoped read legacy status.py's PromptLibAPI served
// (models.monitoring.tracing.view).
func (h *Handler) StatusProject(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":    h.cfg.Enabled,
		"project_id": chi.URLParam(r, "projectID"),
	})
}

// StatusAdmin serves GET /tracing/status/administration — legacy status.py's
// AdminAPI (models.admin.tracing.view).
func (h *Handler) StatusAdmin(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": h.cfg.Enabled,
		"config": map[string]any{
			"collector_endpoint": h.cfg.CollectorHTTPEndpoint,
			"service_name":       h.cfg.ServiceName,
		},
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
