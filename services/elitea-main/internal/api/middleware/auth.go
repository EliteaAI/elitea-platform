package middleware

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
)

// TokenValidator validates a token string and returns the authenticated user.
type TokenValidator interface {
	ValidateToken(ctx context.Context, token string) (auth.User, error)
}

// AuthCache provides get/set for caching validated tokens.
type AuthCache interface {
	GetCached(ctx context.Context, key string) (*auth.User, error)
	SetCached(ctx context.Context, key string, user auth.User) error
}

type AuthConfig struct {
	Client        *authsvc.Client // Legacy RPC client (also implements cache)
	Validator     TokenValidator  // Local validator (used if non-nil, falls back to Client)
	SessionSecret string          // HMAC key for session cookies

	// TrustedProxyCIDRs is the list of CIDR ranges from which Traefik
	// forward-auth headers (X-Auth-Type / X-Auth-Id / X-Auth-Reference) are
	// accepted. When empty at Auth() call time, the value of the
	// TRUSTED_PROXY_CIDRS environment variable is used instead. If neither is
	// configured, Traefik header-auth is disabled (safe default).
	TrustedProxyCIDRs []string
}

// parseTrustedCIDRs converts a slice of CIDR strings into *net.IPNet values,
// logging and skipping any entries that cannot be parsed.
func parseTrustedCIDRs(cidrs []string) []*net.IPNet {
	var out []*net.IPNet
	for _, cidr := range cidrs {
		cidr = strings.TrimSpace(cidr)
		if cidr == "" {
			continue
		}
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			slog.Default().Error("middleware: invalid CIDR in trusted proxy list; ignoring", "cidr", cidr, "err", err)
			continue
		}
		out = append(out, network)
	}
	return out
}

// isFromTrustedProxy reports whether the request's direct RemoteAddr (NOT any
// X-Forwarded-For value, which is spoofable) belongs to one of the provided
// trusted proxy CIDRs. Returns false when cidrs is empty.
func isFromTrustedProxy(r *http.Request, cidrs []*net.IPNet) bool {
	if len(cidrs) == 0 {
		return false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		// RemoteAddr without a port (uncommon in production); try it raw.
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	for _, network := range cidrs {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func Auth(cfg AuthConfig) func(http.Handler) http.Handler {
	// devMode and session auth are mutually exclusive (enforced at startup in main.go).
	// devMode is ONLY allowed when APPLICATION_SECRET_KEY is unset.
	devMode := os.Getenv("AUTH_DEV_MODE") == "true" && cfg.SessionSecret == ""

	// Resolve the trusted-proxy CIDR list once at construction time. If the
	// caller did not supply CIDRs, fall back to the TRUSTED_PROXY_CIDRS env var.
	// An empty result disables Traefik header-auth (safe default).
	rawCIDRs := cfg.TrustedProxyCIDRs
	if len(rawCIDRs) == 0 {
		raw := os.Getenv("TRUSTED_PROXY_CIDRS")
		if raw == "" {
			slog.Default().Warn("middleware: TRUSTED_PROXY_CIDRS is not set; Traefik header-auth (X-Auth-Type/X-Auth-Id) is DISABLED until it is configured")
		} else {
			rawCIDRs = strings.Split(raw, ",")
		}
	}
	trustedCIDRs := parseTrustedCIDRs(rawCIDRs)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Only honor Traefik forward-auth headers when the request arrives from
			// a trusted proxy source. The check is intentionally on the direct
			// RemoteAddr (not X-Forwarded-For) so a client cannot spoof it.
			if isFromTrustedProxy(r, trustedCIDRs) {
				if user, ok := tryTraefikHeaders(r); ok {
					ctx := auth.ContextWithUser(r.Context(), user)
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
			}

			// X-API-Key header (pylon compatibility)
			if apiKey := r.Header.Get("X-API-Key"); apiKey != "" {
				cacheKey := authCacheKey("apikey:" + apiKey)
				if cached, err := cfg.Client.GetCached(r.Context(), cacheKey); err == nil && cached != nil {
					ctx := auth.ContextWithUser(r.Context(), *cached)
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
				user, err := validateToken(r.Context(), cfg, apiKey)
				if err != nil {
					http.Error(w, `{"error":"invalid api key"}`, http.StatusUnauthorized)
					return
				}
				_ = cfg.Client.SetCached(r.Context(), cacheKey, user)
				ctx := auth.ContextWithUser(r.Context(), user)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				// Try session cookie (set by OIDC/form login)
				if cookie, err := r.Cookie("elitea_session"); err == nil && cfg.SessionSecret != "" {
					if user, ok := verifySessionCookie(cookie.Value, cfg.SessionSecret); ok {
						ctx := auth.ContextWithUser(r.Context(), user)
						next.ServeHTTP(w, r.WithContext(ctx))
						return
					}
				}
				if devMode {
					ctx := auth.ContextWithUser(r.Context(), devUser())
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
				http.Error(w, `{"error":"missing authorization header"}`, http.StatusUnauthorized)
				return
			}

			if devMode {
				ctx := auth.ContextWithUser(r.Context(), devUser())
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			cacheKey := authCacheKey(authHeader)
			if cached, err := cfg.Client.GetCached(r.Context(), cacheKey); err == nil && cached != nil {
				ctx := auth.ContextWithUser(r.Context(), *cached)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			var token string
			if strings.HasPrefix(authHeader, "Bearer ") {
				token = strings.TrimPrefix(authHeader, "Bearer ")
			} else if strings.HasPrefix(authHeader, "Basic ") {
				decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(authHeader, "Basic "))
				if err != nil {
					http.Error(w, `{"error":"invalid basic auth encoding"}`, http.StatusUnauthorized)
					return
				}
				parts := strings.SplitN(string(decoded), ":", 2)
				token = parts[0]
			} else {
				http.Error(w, `{"error":"unsupported authorization scheme"}`, http.StatusUnauthorized)
				return
			}

			user, err := validateToken(r.Context(), cfg, token)
			if err != nil {
				http.Error(w, `{"error":"token validation failed"}`, http.StatusUnauthorized)
				return
			}

			_ = cfg.Client.SetCached(r.Context(), cacheKey, user)

			ctx := auth.ContextWithUser(r.Context(), user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func tryTraefikHeaders(r *http.Request) (auth.User, bool) {
	authType := r.Header.Get("X-Auth-Type")
	authID := r.Header.Get("X-Auth-Id")
	authRef := r.Header.Get("X-Auth-Reference")

	if authType == "" || authID == "" {
		return auth.User{}, false
	}

	return auth.User{
		ID:       authID,
		AuthType: authType,
		Email:    authRef,
	}, true
}

func verifySessionCookie(token, secret string) (auth.User, bool) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return auth.User{}, false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts[0]))
	expectedSig := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(parts[1]), []byte(expectedSig)) {
		return auth.User{}, false
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return auth.User{}, false
	}

	var claims map[string]any
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return auth.User{}, false
	}

	if exp, ok := claims["exp"].(float64); ok {
		if time.Now().Unix() > int64(exp) {
			return auth.User{}, false
		}
	}

	var uid string
	switch v := claims["uid"].(type) {
	case string:
		uid = v
	case float64:
		uid = fmt.Sprintf("%d", int64(v))
	}

	email, _ := claims["email"].(string)

	return auth.User{
		ID:       uid,
		Email:    email,
		AuthType: "session",
		Roles:    []string{"admin"},
	}, true
}

func devUser() auth.User {
	return auth.User{
		ID:       "1",
		Email:    "dev@elitea.ai",
		AuthType: "dev",
		Roles:    []string{"admin"},
	}
}

func authCacheKey(authHeader string) string {
	h := sha256.Sum256([]byte(authHeader))
	return "auth:token:" + hex.EncodeToString(h[:])
}

func validateToken(ctx context.Context, cfg AuthConfig, token string) (auth.User, error) {
	if cfg.Validator != nil {
		return cfg.Validator.ValidateToken(ctx, token)
	}
	return cfg.Client.ValidateToken(ctx, token)
}
