package adminui

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type Config struct {
	StaticDir     string // path to admin_ui/static/dist
	ViteServerURL string // e.g. "/api/v2"
	BasePath      string // e.g. "/admin/app"
	SecretKey     string // session cookie HMAC key

	// Resolver reads the operator's REAL administration-mode permissions.
	//
	// A nil Resolver means "no permissions". It never means "all permissions".
	// A mis-wired composition root must degrade closed.
	Resolver auth.PermissionResolver
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
	// Roles is always empty. The resolver reports permissions only, and no
	// bundle reads this field. It stays in the payload so an older admin
	// bundle that reads `roles` gets an empty list, never "super_admin".
	Roles []string `json:"roles"`
}

func (h *Handler) ServeSPA(w http.ResponseWriter, r *http.Request) {
	cfg := adminUIConfig{
		ViteServerURL: h.cfg.ViteServerURL,
		ViteBaseURI:   h.cfg.BasePath,
		Permissions:   []string{},
		Roles:         []string{},
	}

	// Read the operator from the session cookie, then resolve the permissions
	// that operator really holds.
	//
	// DEFECT this replaces: the handler wrote a fixed list of 37 admin
	// permissions, plus roles ["super_admin"], for EVERY caller whose cookie
	// passed the HMAC and exp check. A rank-and-file user who opened
	// /admin/app therefore saw the whole admin console. Every destructive
	// control stayed visible and enabled. Each click ended in a
	// server-side 403.
	// A suspended user with an unexpired cookie saw the same, because
	// verifySession never reads the database.
	//
	// The resolver closes both halves with one query: the administration mode
	// reads only roles with mode='administration', and the resolver refuses a
	// suspended user.
	if cookie, err := r.Cookie("elitea_session"); err == nil && h.cfg.SecretKey != "" {
		if claims := h.verifySession(cookie.Value); claims != nil {
			if email, ok := claims["email"].(string); ok {
				cfg.UserEmail = email
				cfg.UserName = email
			}
			// The minting code writes the claim as `uid`. The old code read
			// `user_id`, so window.admin_ui_config.user_id was null on every
			// page load. See internal/api/v2/auth/session.go makeSessionToken.
			if userID, ok := sessionClaimUserID(claims); ok {
				cfg.UserID = userID
				cfg.Permissions = h.resolvePermissions(r.Context(), userID)
			}
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

// resolvePermissions returns the administration-mode permissions of one user.
//
// It returns an empty list on ANY error, a refusal included. The injected list
// is a presentation hint for the admin SPA, so an empty list hides controls.
// It never grants anything: every admin route resolves the permissions again.
func (h *Handler) resolvePermissions(ctx context.Context, userID int64) []string {
	if h.cfg.Resolver == nil {
		return []string{}
	}
	resolution, err := h.cfg.Resolver.ResolvePermissions(
		ctx,
		auth.User{UserID: strconv.FormatInt(userID, 10)},
		auth.PermissionModeAdministration,
		"",
	)
	if err != nil {
		slog.DebugContext(ctx, "admin ui: permission resolution refused or failed",
			"user_id", userID, "error", err)
		return []string{}
	}
	if resolution.Permissions == nil {
		return []string{}
	}
	return resolution.Permissions
}

// sessionClaimUserID reads the `uid` claim of the session cookie. It accepts
// the string and the number form, because encoding/json decodes a JSON number
// as float64. It mirrors the reader in internal/api/v2/auth/session.go.
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
