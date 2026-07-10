package middleware

import (
	"net/http"
	"strings"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

func RequirePermissions(required ...string) func(http.Handler) http.Handler {
	requiredSet := make(map[string]struct{}, len(required))
	for _, p := range required {
		requiredSet[p] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := auth.UserFromContext(r.Context())
			if !ok {
				http.Error(w, `{"error":"authentication required"}`, http.StatusUnauthorized)
				return
			}

			expanded := ExpandPermissions(user.Permissions)

			if !hasIntersection(requiredSet, expanded) {
				http.Error(w, `{"error":"insufficient permissions"}`, http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func ExpandPermissions(perms []string) map[string]struct{} {
	expanded := make(map[string]struct{})
	for _, p := range perms {
		parts := strings.Split(p, ".")
		for i := 1; i <= len(parts); i++ {
			expanded[strings.Join(parts[:i], ".")] = struct{}{}
		}
	}
	return expanded
}

func hasIntersection(required, userPerms map[string]struct{}) bool {
	for k := range required {
		if _, ok := userPerms[k]; ok {
			return true
		}
	}
	return false
}
