package middleware

import (
	"net/http"
)

// RBAC enforces role-based access control for the resolved project and user.
// TODO: implement permission checks against the RBAC policy engine.
func RBAC(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Placeholder: pass through until RBAC policy engine is wired.
		next.ServeHTTP(w, r)
	})
}
