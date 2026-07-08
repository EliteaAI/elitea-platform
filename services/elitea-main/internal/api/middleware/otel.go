package middleware

import (
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

var tracer trace.Tracer

func init() {
	tracer = otel.Tracer("elitea-main")
}

// OtelMiddleware instruments HTTP handlers with OpenTelemetry tracing and
// metrics.
// TODO: wire up go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp
// for full span propagation and metrics.
func OtelMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, span := tracer.Start(r.Context(), r.URL.Path)
		defer span.End()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
