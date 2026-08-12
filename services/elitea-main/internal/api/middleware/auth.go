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
	"strconv"
	"strings"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
)

// TokenValidator validates a token string and returns the authenticated user.
type TokenValidator interface {
	ValidateToken(ctx context.Context, token string) (auth.User, error)
}

// PrincipalValidator checks mutable account state after credentials have been
// validated, including signed sessions.
type PrincipalValidator interface {
	ValidatePrincipal(ctx context.Context, principal auth.User) (auth.User, error)
}

// ForwardedIdentityPeerVerifier proves that an X-Auth-* request arrived over
// the isolated, header-stripping ingress boundary. Reloading an active user is
// not proof that the caller was entitled to assert that user ID.
type ForwardedIdentityPeerVerifier interface {
	VerifyForwardedIdentityPeer(*http.Request) error
}

type AuthConfig struct {
	Client                    *authsvc.Client // Legacy RPC validator used only when Validator is nil.
	Validator                 TokenValidator  // Local validator (used if non-nil, falls back to Client)
	PrincipalValidator        PrincipalValidator
	ForwardedIdentityVerifier ForwardedIdentityPeerVerifier
	SessionSecret             string // HMAC key for session cookies
	// TrustedProxyCIDRs preserves the current Main compatibility boundary for
	// deployments where Traefik is the authenticated identity peer. New
	// production composition should prefer ForwardedIdentityVerifier.
	TrustedProxyCIDRs []string
}

// Auth authenticates every request against exactly four credential sources:
// forwarded identity, API key, bearer token, and session cookie. There is no
// fifth source and no configuration that yields a principal without a
// credential.
//
// In particular there is no environment-variable bypass. The former
// AUTH_DEV_MODE flag injected an admin principal impersonating database user 1
// for any request — including one carrying an Authorization header, since the
// bypass ran before token validation — and skipped PrincipalValidator
// entirely. Its two documented guards were both illusory: the "enforced at
// startup in main.go" mutual exclusion never existed, and the
// `cfg.SessionSecret == ""` conjunct was evaluated per AuthConfig, leaving it
// open for the 16 of 21 configs in main.go that never set SessionSecret. See
// ADR-0017. Development and CI authenticate through the mock OIDC provider;
// tests inject a stub TokenValidator via RouterConfig.
func Auth(cfg AuthConfig) func(http.Handler) http.Handler {
	trustedCIDRs := configuredTrustedProxyCIDRs(cfg.TrustedProxyCIDRs)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user, ok := tryTraefikHeaders(r, cfg.ForwardedIdentityVerifier); ok {
				// A forwarded token ID is not an owning user ID. The authoritative
				// principal check must cross-check both typed IDs and normalize the
				// compatibility ID before any downstream handler can use it as a
				// user foreign key.
				if cfg.PrincipalValidator == nil {
					writeInactivePrincipal(w)
					return
				}
				user, err := validatePrincipal(r.Context(), cfg, user)
				if err != nil {
					writeInactivePrincipal(w)
					return
				}
				serveAuthenticated(next, w, r, user, auth.AuthenticationSourceForwarded)
				return
			}
			if cfg.ForwardedIdentityVerifier == nil && isFromTrustedProxy(r, trustedCIDRs) {
				if user, ok := tryTrustedProxyHeaders(r); ok {
					serveAuthenticated(next, w, r, user, auth.AuthenticationSourceForwarded)
					return
				}
			}

			// X-API-Key header (pylon compatibility)
			if apiKey := r.Header.Get("X-API-Key"); apiKey != "" {
				user, err := validateToken(r.Context(), cfg, apiKey)
				if err != nil {
					writeJSONError(w, http.StatusUnauthorized, "authentication_error", "unauthenticated", "invalid api key")
					return
				}
				user, err = validatePrincipal(r.Context(), cfg, user)
				if err != nil {
					writeInactivePrincipal(w)
					return
				}
				serveAuthenticated(next, w, r, user, auth.AuthenticationSourceAPIKey)
				return
			}

			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				// Try session cookie (set by OIDC/form login)
				if cookie, err := r.Cookie("elitea_session"); err == nil && cfg.SessionSecret != "" {
					if user, ok := verifySessionCookie(cookie.Value, cfg.SessionSecret); ok {
						user, validationErr := validatePrincipal(r.Context(), cfg, user)
						if validationErr != nil {
							writeInactivePrincipal(w)
							return
						}
						serveAuthenticated(next, w, r, user, auth.AuthenticationSourceSession)
						return
					}
				}
				writeJSONError(w, http.StatusUnauthorized, "authentication_error", "unauthenticated", "missing authorization header")
				return
			}

			var token string
			if strings.HasPrefix(authHeader, "Bearer ") {
				token = strings.TrimPrefix(authHeader, "Bearer ")
			} else if strings.HasPrefix(authHeader, "Basic ") {
				decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(authHeader, "Basic "))
				if err != nil {
					writeJSONError(w, http.StatusUnauthorized, "authentication_error", "unauthenticated", "invalid basic auth encoding")
					return
				}
				parts := strings.SplitN(string(decoded), ":", 2)
				token = parts[0]
			} else {
				writeJSONError(w, http.StatusUnauthorized, "authentication_error", "unauthenticated", "unsupported authorization scheme")
				return
			}

			user, err := validateToken(r.Context(), cfg, token)
			if err != nil {
				writeJSONError(w, http.StatusUnauthorized, "authentication_error", "unauthenticated", "token validation failed")
				return
			}

			user, err = validatePrincipal(r.Context(), cfg, user)
			if err != nil {
				writeInactivePrincipal(w)
				return
			}
			serveAuthenticated(next, w, r, user, auth.AuthenticationSourceToken)
		})
	}
}

// jsonError is the OpenAI-shaped nested error envelope mandated by spec §2.5:
// {"error":{"message","type","code"}}.
type jsonError struct {
	Error jsonErrorFields `json:"error"`
}

type jsonErrorFields struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    string `json:"code,omitempty"`
}

// writeJSONError writes a spec §2.5 nested JSON error body with
// Content-Type: application/json, replacing the flat text/plain bodies
// http.Error produces. Used by both this file and project.go.
func writeJSONError(w http.ResponseWriter, status int, errType, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(jsonError{Error: jsonErrorFields{Message: message, Type: errType, Code: code}})
}

func configuredTrustedProxyCIDRs(configured []string) []*net.IPNet {
	rawCIDRs := configured
	if len(rawCIDRs) == 0 {
		if raw := os.Getenv("TRUSTED_PROXY_CIDRS"); raw != "" {
			rawCIDRs = strings.Split(raw, ",")
		}
	}
	networks := make([]*net.IPNet, 0, len(rawCIDRs))
	for _, cidr := range rawCIDRs {
		cidr = strings.TrimSpace(cidr)
		if cidr == "" {
			continue
		}
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			slog.Default().Error("middleware: ignoring invalid trusted proxy CIDR", "cidr", cidr, "err", err)
			continue
		}
		networks = append(networks, network)
	}
	return networks
}

func isFromTrustedProxy(r *http.Request, networks []*net.IPNet) bool {
	if len(networks) == 0 {
		return false
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	for _, network := range networks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func tryTrustedProxyHeaders(r *http.Request) (auth.User, bool) {
	authType := r.Header.Get("X-Auth-Type")
	authID := r.Header.Get("X-Auth-Id")
	if authType == "" || authID == "" || strings.ContainsAny(authType+authID, "\x00\r\n") {
		return auth.User{}, false
	}
	return auth.User{
		ID:       authID,
		UserID:   authID,
		Email:    r.Header.Get("X-Auth-Reference"),
		AuthType: authType,
	}, true
}

func tryTraefikHeaders(r *http.Request, verifier ForwardedIdentityPeerVerifier) (auth.User, bool) {
	authType, typePresent, typeValid := uniqueForwardedIdentityHeader(r.Header, "X-Auth-Type")
	authID, idPresent, idValid := uniqueForwardedIdentityHeader(r.Header, "X-Auth-ID")
	if !typePresent && !idPresent {
		return auth.User{}, false
	}
	if verifier == nil || !typePresent || !idPresent || !typeValid || !idValid ||
		verifier.VerifyForwardedIdentityPeer(r) != nil {
		return auth.User{}, false
	}
	// X-Auth-Reference is compatibility routing material and may be a browser
	// session bearer value. It is never an identity claim; the mandatory
	// PrincipalValidator reloads mutable email from PostgreSQL.

	if !strings.EqualFold(authType, "token") && !strings.EqualFold(authType, "user") {
		return auth.User{}, false
	}
	authType = strings.ToLower(authType)

	user := auth.User{
		ID:       authID,
		AuthType: authType,
	}
	if authType == "token" {
		userID, present, valid := uniqueForwardedIdentityHeader(r.Header, "X-Auth-User-ID")
		if !present || !valid {
			return auth.User{}, false
		}
		user.TokenID = authID
		user.UserID = userID
	} else {
		user.UserID = authID
	}
	return user, true
}

func uniqueForwardedIdentityHeader(headers http.Header, name string) (string, bool, bool) {
	var values []string
	for key, current := range headers {
		if strings.EqualFold(key, name) {
			values = append(values, current...)
		}
	}
	if len(values) == 0 {
		return "", false, true
	}
	if len(values) != 1 || values[0] == "" || values[0] != strings.TrimSpace(values[0]) ||
		strings.ContainsAny(values[0], "\x00\r\n") {
		return "", true, false
	}
	return values[0], true, true
}

func validatePrincipal(ctx context.Context, cfg AuthConfig, user auth.User) (auth.User, error) {
	if cfg.PrincipalValidator == nil {
		return user, nil
	}
	return cfg.PrincipalValidator.ValidatePrincipal(ctx, user)
}

func serveAuthenticated(next http.Handler, w http.ResponseWriter, r *http.Request, user auth.User, source auth.AuthenticationSource) {
	ctx := auth.ContextWithAuthenticatedUser(r.Context(), user, source)
	next.ServeHTTP(w, r.WithContext(ctx))
}

func writeInactivePrincipal(w http.ResponseWriter) {
	writeJSONError(w, http.StatusUnauthorized, "authentication_error", "unauthenticated", "authenticated principal is inactive")
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

	exp, ok := claims["exp"].(float64)
	if !ok || exp != float64(int64(exp)) || time.Now().Unix() > int64(exp) {
		return auth.User{}, false
	}

	var uid string
	switch v := claims["uid"].(type) {
	case string:
		uid = v
	case float64:
		uid = fmt.Sprintf("%d", int64(v))
	}
	if _, ok := positiveSessionUserID(uid); !ok {
		return auth.User{}, false
	}

	email, _ := claims["email"].(string)

	return auth.User{
		ID:       uid,
		UserID:   uid,
		Email:    email,
		AuthType: "session",
	}, true
}

func positiveSessionUserID(value string) (int64, bool) {
	id, err := strconv.ParseInt(value, 10, 64)
	return id, err == nil && id > 0
}

func validateToken(ctx context.Context, cfg AuthConfig, token string) (auth.User, error) {
	if cfg.Validator != nil {
		return cfg.Validator.ValidateToken(ctx, token)
	}
	if cfg.Client == nil {
		return auth.User{}, fmt.Errorf("authentication validator is not configured")
	}
	return cfg.Client.ValidateToken(ctx, token)
}
