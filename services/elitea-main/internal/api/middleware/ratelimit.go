package middleware

import (
	"net/http"
)

// RateLimit enforces per-client request rate limits.
// TODO: implement using Redis token-bucket / sliding-window counters.
func RateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Placeholder: pass through until Redis-backed rate limiting is implemented.
		next.ServeHTTP(w, r)
	})
}
