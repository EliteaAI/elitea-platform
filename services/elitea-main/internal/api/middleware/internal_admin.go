package middleware

import (
	"crypto/sha256"
	"crypto/subtle"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
	"net/http"
	"strings"
)

const MinimumInternalAdminTokenBytes = 32

// RequireInternalAdminToken protects operational routes that do not have a
// legacy end-user permission contract. The expected token is configuration,
// never a caller-supplied user or project identity.
func RequireInternalAdminToken(expected string) func(http.Handler) http.Handler {
	expectedHash := sha256.Sum256([]byte(expected))
	configured := len(expected) >= MinimumInternalAdminTokenBytes

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			provided, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			providedHash := sha256.Sum256([]byte(provided))
			if !configured || !ok || provided == "" || subtle.ConstantTimeCompare(expectedHash[:], providedHash[:]) != 1 {
				w.Header().Set("WWW-Authenticate", `Bearer realm="elitea-internal-admin"`)
				apierr.WriteStatus(w, http.StatusUnauthorized, "internal authorization required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
