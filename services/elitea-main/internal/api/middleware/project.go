package middleware

import (
	"net/http"
)

// Project resolves the project ID from the URL path or header and injects it
// into the request context.
// TODO: implement project resolution and context injection.
func Project(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Placeholder: pass through until project resolution is implemented.
		next.ServeHTTP(w, r)
	})
}
