package middleware

import (
	"net/http"
)

// Auth validates the bearer token present in the Authorization header.
// TODO: delegate to authsvc RPC call.
func Auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Placeholder: pass through until authsvc integration is wired.
		next.ServeHTTP(w, r)
	})
}
