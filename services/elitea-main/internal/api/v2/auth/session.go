package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

type SessionHandler struct {
	pool      *pgxpool.Pool
	redis     *goredis.Client
	secretKey string
}

func NewSessionHandler(pool *pgxpool.Pool, redis *goredis.Client, secretKey string) *SessionHandler {
	return &SessionHandler{pool: pool, redis: redis, secretKey: secretKey}
}

func (h *SessionHandler) Login(w http.ResponseWriter, r *http.Request) {
	targetTo := r.URL.Query().Get("target_to")
	isError := r.URL.Query().Get("error") != ""

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = loginTmpl.Execute(w, map[string]any{
		"Action":   "/forward-auth/auth_form/authorize",
		"Target":   targetTo,
		"HasError": isError,
	})
}

func (h *SessionHandler) Authorize(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Redirect(w, r, "/forward-auth/auth_form/login?error=true", http.StatusFound)
		return
	}
	targetTo := r.FormValue("target")
	login := strings.TrimSpace(r.FormValue("login"))
	password := r.FormValue("password")

	ctx := r.Context()
	userID, err := h.authenticateUser(ctx, login, password)
	if err != nil {
		http.Redirect(w, r, "/forward-auth/auth_form/login?error=true", http.StatusFound)
		return
	}

	sessionToken := h.createSessionToken(userID, login)

	http.SetCookie(w, &http.Cookie{
		Name:     "elitea_session",
		Value:    sessionToken,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   86400,
	})

	redirectURL := "/"
	if targetTo != "" {
		redirectURL = targetTo
	}
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

func (h *SessionHandler) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "elitea_session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})

	targetTo := r.URL.Query().Get("target_to")
	redirectURL := "/"
	if targetTo != "" {
		redirectURL = targetTo
	}
	http.Redirect(w, r, redirectURL, http.StatusFound)
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

	writeSessionJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"user_id":       claims["uid"],
		"email":         claims["email"],
	})
}

func (h *SessionHandler) authenticateUser(ctx context.Context, login, password string) (string, error) {
	var userID, passHash string
	err := h.pool.QueryRow(ctx,
		`SELECT u.id, u.password FROM auth_core__user u WHERE u.email = $1 AND u.is_active = true`,
		login,
	).Scan(&userID, &passHash)
	if err != nil {
		return "", fmt.Errorf("user not found")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passHash), []byte(password)); err != nil {
		return "", fmt.Errorf("invalid password")
	}

	return userID, nil
}

func (h *SessionHandler) createSessionToken(userID, email string) string {
	return makeSessionToken(h.secretKey, userID, email)
}

func (h *SessionHandler) parseSessionToken(token string) (map[string]any, error) {
	return verifySessionToken(h.secretKey, token)
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

	if exp, ok := claims["exp"].(float64); ok {
		if time.Now().Unix() > int64(exp) {
			return nil, fmt.Errorf("token expired")
		}
	}

	return claims, nil
}

func writeSessionJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// Suppress unused import warning for rand
var _ = rand.Reader

var loginTmpl = template.Must(template.New("login").Parse(`<!DOCTYPE html>
<html>
<head>
<title>Elitea - Login</title>
<style>
body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
.card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); width: 320px; }
h1 { margin: 0 0 1.5rem; font-size: 1.5rem; text-align: center; }
input { width: 100%; padding: 0.75rem; margin-bottom: 1rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; font-size: 1rem; }
button { width: 100%; padding: 0.75rem; background: #1976d2; color: white; border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; }
button:hover { background: #1565c0; }
.error { color: #d32f2f; text-align: center; margin-bottom: 1rem; font-size: 0.875rem; }
</style>
</head>
<body>
<div class="card">
<h1>Elitea Login</h1>
{{if .HasError}}<div class="error">Invalid credentials</div>{{end}}
<form method="POST" action="{{.Action}}">
<input type="hidden" name="target" value="{{.Target}}">
<input type="text" name="login" placeholder="Email" required autofocus>
<input type="password" name="password" placeholder="Password" required>
<button type="submit">Sign In</button>
</form>
</div>
</body>
</html>`))
