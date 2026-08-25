package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth/browserflow"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// sessionUsers is the one read Info makes. *pgxpool.Pool satisfies it. The
// interface exists so a test can supply a store that fails. This handler must
// not report that state as "you are not authenticated".
type sessionUsers interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type SessionHandler struct {
	users         sessionUsers
	secretKey     string
	secureCookies bool
}

func NewSessionHandler(pool *pgxpool.Pool, secretKey string) *SessionHandler {
	handler := &SessionHandler{secretKey: secretKey, secureCookies: os.Getenv("COOKIE_SECURE") != "false"}
	// A nil *pgxpool.Pool in an interface field is not a nil interface, and
	// every later nil test then passes while the call panics.
	if pool != nil {
		handler.users = pool
	}
	return handler
}

func (h *SessionHandler) Logout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	http.SetCookie(w, &http.Cookie{
		Name:     "elitea_session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   h.secureCookies,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})

	target := "/"
	if canonical, err := browserflow.CanonicalReturnTarget(r.URL.Query().Get("target_to")); err == nil {
		target = canonical
	}
	http.Redirect(w, r, target, http.StatusFound)
}

// Info reports whether the browser holds a usable session.
//
// The answer has three outcomes, and they must stay apart. `authenticated:
// false` is a statement about the CALLER: there is no session, or the session
// is not usable. The web app acts on it by sending the user to the identity
// provider. A database that cannot answer says nothing about the caller, so
// reporting it as `authenticated: false` signs out a user who holds a valid,
// unexpired cookie, and the identity provider bounces the browser straight
// back. A 503 lets the app keep the session and retry.
func (h *SessionHandler) Info(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("elitea_session")
	if err != nil || cookie.Value == "" {
		writeSessionJSON(w, http.StatusOK, map[string]any{"authenticated": false})
		return
	}

	claims, err := h.parseSessionToken(cookie.Value)
	if err != nil {
		writeSessionJSON(w, http.StatusOK, map[string]any{"authenticated": false})
		return
	}
	userID, ok := sessionClaimUserID(claims)
	if !ok {
		writeSessionJSON(w, http.StatusOK, map[string]any{"authenticated": false})
		return
	}
	if h.users == nil {
		// Composition error, not an outage and not a missing session. The
		// OIDC branch of main.go always passes a pool.
		slog.Error("session info: the handler has no user store")
		writeSessionJSON(w, http.StatusInternalServerError,
			map[string]any{"error": "session service is not configured"})
		return
	}

	var activeUserID int64
	if err := h.users.QueryRow(r.Context(),
		`SELECT id FROM public.auth_core__user WHERE id = $1 AND suspended = false`,
		userID,
	).Scan(&activeUserID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// The user is absent or suspended. That IS an answer about the
			// caller.
			writeSessionJSON(w, http.StatusOK, map[string]any{"authenticated": false})
			return
		}
		slog.Error("session info: the user lookup failed", "err", err)
		w.Header().Set("Retry-After", "5")
		writeSessionJSON(w, http.StatusServiceUnavailable,
			map[string]any{"error": "session store unavailable"})
		return
	}

	writeSessionJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"user_id":       strconv.FormatInt(activeUserID, 10),
		"email":         claims["email"],
	})
}

func (h *SessionHandler) parseSessionToken(token string) (map[string]any, error) {
	return verifySessionToken(h.secretKey, token)
}

func sessionClaimUserID(claims map[string]any) (int64, bool) {
	switch value := claims["uid"].(type) {
	case string:
		id, err := strconv.ParseInt(value, 10, 64)
		return id, err == nil && id > 0
	case float64:
		id := int64(value)
		return id, value == float64(id) && id > 0
	default:
		return 0, false
	}
}

func makeSessionToken(secretKey, userID, email string) string {
	payload := map[string]any{
		"uid":   userID,
		"email": email,
		"exp":   time.Now().Add(24 * time.Hour).Unix(),
	}
	payloadBytes, _ := json.Marshal(payload)
	encoded := base64.RawURLEncoding.EncodeToString(payloadBytes)

	mac := hmac.New(sha256.New, []byte(secretKey))
	mac.Write([]byte(encoded))
	sig := hex.EncodeToString(mac.Sum(nil))

	return encoded + "." + sig
}

func verifySessionToken(secretKey, token string) (map[string]any, error) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid token format")
	}

	mac := hmac.New(sha256.New, []byte(secretKey))
	mac.Write([]byte(parts[0]))
	expectedSig := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(parts[1]), []byte(expectedSig)) {
		return nil, fmt.Errorf("invalid signature")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}

	var claims map[string]any
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, err
	}

	exp, ok := claims["exp"].(float64)
	if !ok || exp != float64(int64(exp)) {
		return nil, fmt.Errorf("session expiration is missing or invalid")
	}
	if time.Now().Unix() > int64(exp) {
		return nil, fmt.Errorf("token expired")
	}

	return claims, nil
}

func writeSessionJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
