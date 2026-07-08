// Package observability provides shared OpenTelemetry setup helpers for all
// Elitea Go services.
package observability

import (
	"context"
	"log/slog"
)

// Config holds observability configuration.
type Config struct {
	ServiceName    string
	ServiceVersion string
	OTLPEndpoint   string
	Enabled        bool
}

// Provider wraps the OTel SDK providers.
// TODO: initialize TracerProvider, MeterProvider, and LoggerProvider.
type Provider struct {
	cfg Config
}

// New sets up the OTel SDK and returns a Provider.
// Call Shutdown on process exit to flush telemetry data.
func New(ctx context.Context, cfg Config) (*Provider, error) {
	if !cfg.Enabled {
		slog.Info("observability: OTel disabled, using no-op providers")
		return &Provider{cfg: cfg}, nil
	}
	// TODO: configure OTLP exporter and wire up SDK providers.
	slog.Info("observability: initializing", "service", cfg.ServiceName, "endpoint", cfg.OTLPEndpoint)
	return &Provider{cfg: cfg}, nil
}

// Shutdown flushes and stops all telemetry pipelines.
func (p *Provider) Shutdown(ctx context.Context) error {
	// TODO: shut down SDK providers gracefully.
	return nil
}
