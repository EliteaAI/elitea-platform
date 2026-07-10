package middleware

import (
	"net/http"
	"strconv"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

var (
	tracer          trace.Tracer
	requestDuration metric.Float64Histogram
	requestsTotal   metric.Int64Counter
	activeRequests  metric.Int64UpDownCounter
)

func init() {
	tracer = otel.Tracer("elitea-main")
	meter := otel.Meter("elitea-main")

	requestDuration, _ = meter.Float64Histogram(
		"http.server.request.duration",
		metric.WithUnit("s"),
		metric.WithDescription("HTTP request duration in seconds"),
	)
	requestsTotal, _ = meter.Int64Counter(
		"http.server.requests_total",
		metric.WithDescription("Total HTTP requests"),
	)
	activeRequests, _ = meter.Int64UpDownCounter(
		"http.server.active_requests",
		metric.WithDescription("Number of active HTTP requests"),
	)
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func OtelMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, span := tracer.Start(r.Context(), r.Method+" "+r.URL.Path)
		defer span.End()

		activeRequests.Add(ctx, 1)
		defer activeRequests.Add(ctx, -1)

		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()

		next.ServeHTTP(rec, r.WithContext(ctx))

		duration := time.Since(start).Seconds()
		attrs := []attribute.KeyValue{
			attribute.String("http.method", r.Method),
			attribute.String("http.route", r.URL.Path),
			attribute.String("http.status_code", strconv.Itoa(rec.status)),
		}

		requestDuration.Record(ctx, duration, metric.WithAttributes(attrs...))
		requestsTotal.Add(ctx, 1, metric.WithAttributes(attrs...))

		span.SetAttributes(attrs...)
	})
}
