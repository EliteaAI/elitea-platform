package adminui

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
)

type Config struct {
	StaticDir     string // path to admin_ui/static/dist
	ViteServerURL string // e.g. "/api/v2"
	BasePath      string // e.g. "/admin/app"
	SecretKey     string // session cookie HMAC key
}

type Handler struct {
	cfg       Config
	indexOnce sync.Once
	indexHTML string
}

func NewHandler(cfg Config) *Handler {
	return &Handler{cfg: cfg}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	assetsDir := filepath.Join(h.cfg.StaticDir, "assets")
	r.Handle("/assets/*", http.StripPrefix(h.cfg.BasePath+"/assets/", http.FileServer(http.Dir(assetsDir))))
	r.Get("/*", h.ServeSPA)
	r.Get("/", h.ServeSPA)
	return r
}

type adminUIConfig struct {
	ViteServerURL string   `json:"vite_server_url"`
	ViteBaseURI   string   `json:"vite_base_uri"`
	UserID        any      `json:"user_id"`
	UserName      string   `json:"user_name"`
	UserEmail     string   `json:"user_email"`
	Permissions   []string `json:"permissions"`
	Roles         []string `json:"roles"`
}

func (h *Handler) ServeSPA(w http.ResponseWriter, r *http.Request) {
	cfg := adminUIConfig{
		ViteServerURL: h.cfg.ViteServerURL,
		ViteBaseURI:   h.cfg.BasePath,
		Permissions:   []string{},
		Roles:         []string{},
	}

	// Try to extract user from session cookie
	if cookie, err := r.Cookie("elitea_session"); err == nil && h.cfg.SecretKey != "" {
		if claims := h.verifySession(cookie.Value); claims != nil {
			cfg.UserID = claims["user_id"]
			if email, ok := claims["email"].(string); ok {
				cfg.UserEmail = email
				cfg.UserName = email
			}
			cfg.Permissions = []string{
				"admin.auth.users", "admin.auth.users.super_admin",
				"configuration", "configuration.roles",
				"configuration.roles.permissions.view", "configuration.roles.permissions.edit",
				"configuration.roles.roles.view", "configuration.roles.roles.create",
				"configuration.roles.roles.edit", "configuration.roles.roles.delete",
				"configuration.users", "configuration.users.users.view",
				"configuration.users.users.create", "configuration.users.users.edit",
				"configuration.users.users.delete",
				"projects", "projects.projects",
				"projects.projects.projects.view", "projects.projects.projects.edit",
				"configuration.secrets.secret.list", "configuration.secrets.secret.create",
				"configuration.secrets.secret.edit", "configuration.secrets.secret.delete",
				"configuration.litellm", "configuration.litellm.edit",
				"configuration.advanced", "configuration.service_descriptors",
				"runtime", "runtime.plugins",
				"configuration.scheduling.schedules.view", "configuration.scheduling.schedules.edit",
				"models.admin.audit_trail.view",
				"admin.moderation", "admin.moderation.view",
				"admin.moderation.create", "admin.moderation.edit",
			}
			cfg.Roles = []string{"super_admin"}
		}
	}

	cfgJSON, _ := json.Marshal(cfg)

	indexHTML := h.loadIndex()

	// Replace asset paths from relative to absolute
	indexHTML = strings.ReplaceAll(indexHTML, `src="./assets`, fmt.Sprintf(`src="%s/assets`, h.cfg.BasePath))
	indexHTML = strings.ReplaceAll(indexHTML, `href="./assets`, fmt.Sprintf(`href="%s/assets`, h.cfg.BasePath))

	// Inject config.
	//
	// Emitted as a bare JS object literal, NOT as JSON.parse('...'). The quoted
	// form was a script-injection hole (CodeQL go/unsafe-quoting, critical): a
	// single quote anywhere in the payload closes the JS string literal early
	// and everything after it is executed as code. That is reachable, not
	// theoretical — cfg.UserEmail/UserName come from the session JWT's `email`
	// claim, and a single quote is legal in an email local part
	// (o'brien@example.com), so a user whose address contains one injects script
	// into the ADMIN page.
	//
	// Two properties make the bare form safe, and both matter:
	//   1. No surrounding quotes, so there is no string literal to break out of.
	//      JSON has been a syntactic subset of JavaScript since ES2019, so the
	//      value parses as an object literal directly.
	//   2. encoding/json escapes <, > and & to <, > and & by
	//      default, so a payload containing "</script>" cannot terminate the
	//      enclosing tag. Do NOT switch this to a json.Encoder with
	//      SetEscapeHTML(false) — that silently reopens the tag-breakout half.
	configScript := fmt.Sprintf(`<script>window.admin_ui_config = %s;</script>`, string(cfgJSON))
	indexHTML = strings.Replace(indexHTML, "<!-- admin_ui_config -->", configScript, 1)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprint(w, indexHTML)
}

func (h *Handler) verifySession(token string) map[string]any {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return nil
	}

	mac := hmac.New(sha256.New, []byte(h.cfg.SecretKey))
	mac.Write([]byte(parts[0]))
	expectedSig := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(parts[1]), []byte(expectedSig)) {
		return nil
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil
	}

	var claims map[string]any
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil
	}

	if exp, ok := claims["exp"].(float64); ok {
		if time.Now().Unix() > int64(exp) {
			return nil
		}
	}

	return claims
}

func (h *Handler) loadIndex() string {
	h.indexOnce.Do(func() {
		path := filepath.Join(h.cfg.StaticDir, "index.html")
		data, err := os.ReadFile(path)
		if err != nil {
			h.indexHTML = "<html><body>Admin UI not found</body></html>"
			return
		}
		h.indexHTML = string(data)
	})
	return h.indexHTML
}
