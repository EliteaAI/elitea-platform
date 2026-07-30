package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth/browserflow"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SessionHandler struct {
	pool      *pgxpool.Pool
	secretKey string
}

func NewSessionHandler(pool *pgxpool.Pool, secretKey string) *SessionHandler {
	return &SessionHandler{pool: pool, secretKey: secretKey}
}

func (h *SessionHandler) Logout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	http.SetCookie(w, &http.Cookie{
		Name:     "elitea_session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})

	target := "/"
	if canonical, err := browserflow.CanonicalReturnTarget(r.URL.Query().Get("target_to")); err == nil {
		target = canonical
	}
	http.Redirect(w, r, target, http.StatusFound)
}

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
	if !ok || h.pool == nil {
		writeSessionJSON(w, http.StatusOK, map[string]any{"authenticated": false})
		return
	}
	var activeUserID int64
	if err := h.pool.QueryRow(r.Context(),
		`SELECT id FROM public.auth_core__user WHERE id = $1 AND suspended = false`,
		userID,
	).Scan(&activeUserID); err != nil {
		writeSessionJSON(w, http.StatusOK, map[string]any{"authenticated": false})
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
