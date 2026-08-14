// Package observability provides shared OpenTelemetry setup helpers for all
// Elitea Go services. It is the replacement for the legacy tracing plugin's
// server-side SDK wiring (legacy/plugins/tracing/): every service that calls
// New with Enabled=true exports its own spans as an OTLP/HTTP client, batched
// to a collector — the same collector elitea-main's tracing ingest routes
// (internal/api/v2/tracing) proxy browser/worker traces to, so all traces
// land in one place regardless of origin (issue #250).
package observability

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// Config holds observability configuration.
type Config struct {
	ServiceName    string
	ServiceVersion string
	// OTLPEndpoint is the collector's OTLP/HTTP base URL, e.g.
	// "http://otel-collector:4318". Empty defers to the otlptracehttp
	// exporter's own environment handling (OTEL_EXPORTER_OTLP_ENDPOINT /
	// OTEL_EXPORTER_OTLP_TRACES_ENDPOINT), so passing it through explicitly
	// here is a convenience, not the only way to configure it.
	OTLPEndpoint string
	Enabled      bool
}

// ConfigFromEnv reads the standard OTel environment variables. OTEL_SDK_DISABLED
// is the spec-defined kill switch (https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/);
// defaulting Enabled to true when it is unset or anything other than "true"
// means a deployment gets traces the moment OTEL_EXPORTER_OTLP_ENDPOINT points
// at a real collector, with no separate opt-in flag to remember.
func ConfigFromEnv(serviceName, serviceVersion string) Config {
	return Config{
		ServiceName:    serviceName,
		ServiceVersion: serviceVersion,
		OTLPEndpoint:   os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
		Enabled:        os.Getenv("OTEL_SDK_DISABLED") != "true",
	}
}

// Provider wraps the OTel SDK tracer provider. The zero-value-ish disabled
// Provider (returned when Config.Enabled is false) answers Tracer() with the
// global no-op tracer, so callers never need a nil check.
type Provider struct {
	cfg Config
	tp  *sdktrace.TracerProvider
}

// New sets up the OTel SDK and returns a Provider. It also installs the
// tracer provider as the process-wide default via otel.SetTracerProvider, so
// otel.Tracer(...) and otelhttp middleware anywhere in the process pick it up
// without threading the Provider through every call site.
//
// Call Shutdown on process exit to flush telemetry data.
func New(ctx context.Context, cfg Config) (*Provider, error) {
	if !cfg.Enabled {
		slog.Info("observability: OTel disabled, using no-op providers")
		return &Provider{cfg: cfg}, nil
	}

	var opts []otlptracehttp.Option
	if cfg.OTLPEndpoint != "" {
		opts = append(opts, otlptracehttp.WithEndpointURL(cfg.OTLPEndpoint))
	}
	exporter, err := otlptracehttp.New(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("observability: create OTLP trace exporter: %w", err)
	}

	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(
		semconv.ServiceName(cfg.ServiceName),
		semconv.ServiceVersion(cfg.ServiceVersion),
	))
	if err != nil {
		return nil, fmt.Errorf("observability: build resource attributes: %w", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)

	slog.Info("observability: initialized",
		"service", cfg.ServiceName,
		"endpoint", cfg.OTLPEndpoint,
	)
	return &Provider{cfg: cfg, tp: tp}, nil
}

// Shutdown flushes and stops all telemetry pipelines.
func (p *Provider) Shutdown(ctx context.Context) error {
	if p == nil || p.tp == nil {
		return nil
	}
	return p.tp.Shutdown(ctx)
}
