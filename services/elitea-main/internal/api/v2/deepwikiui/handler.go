// Package deepwikiui serves the vendored DeepWiki SPA (ADR-0022 decision 8).
//
// It follows internal/api/adminui, which is this service's settled answer to
// "serve a React bundle from Go with per-user config injected into it": read
// index.html once, rewrite the asset prefix, inject a config object, set a
// hash-based CSP over the one script that was injected, and never cache the
// result. Two of those steps exist because of defects the admin console
// actually shipped — a script-injection hole in the injection itself, and a
// cacheable identity-bearing page — and reproducing the shape is how this
// handler inherits both fixes rather than rediscovering them.
//
// WHAT IS DELIBERATELY DIFFERENT. The admin console injects a permission list
// that its navigation reads. This one injects none: every DeepWiki action goes
// through the facade, which resolves permissions per request, and a list here
// would be a second place for them to be decided. The gate on THIS route is
// membership-shaped — a caller who may not read the project's wikis has no
// business loading the page at all — and it is the same read permission the
// facade's own /slots requires, so the page and its first call agree.
package deepwikiui

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	deepwiki "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/deepwiki"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

// BasePath is where the bundle is served. It must match the vite config's
// `base`, which is compiled into every asset URL the bundle requests: a
// mismatch is a page that loads and then 404s on its own JavaScript.
const BasePath = "/app/deepwiki"

// StaticDirEnv names the built bundle's directory. Separate from the facade's
// own flag: an image can carry the facade and no UI (the hybrid target does),
// and mounting a page with no bundle renders an empty document.
const StaticDirEnv = "DEEPWIKI_UI_STATIC_DIR"

// ProjectPath carries the project the SPA opens on.
//
// The project is in the URL rather than in a query string or a cookie because
// it is what the route's permission check resolves against, and because a
// bookmarked wiki should reopen the project it was bookmarked in.
const ProjectPath = BasePath + "/{project_id}"

// ErrInvalidHandler reports a handler that cannot be composed.
var ErrInvalidHandler = errors.New("invalid DeepWiki UI handler")

// Config is what the handler needs.
type Config struct {
	// StaticDir is the built bundle: index.html plus assets/.
	StaticDir string

	// APIBase is the platform API prefix the SPA calls. Injected rather than
	// compiled in, so one bundle serves any deployment.
	APIBase string
}

// Handler serves the SPA.
type Handler struct {
	cfg       Config
	indexOnce sync.Once
	indexHTML string
	handler   http.Handler
}

// uiConfig is what lands in `window.deepwiki_ui_config`.
//
// The keys are LOWER-CASE because the bundle's getEnvVar() lower-cases the
// name it looks up. A capitalised key here is a value the SPA silently never
// finds, and it falls back to a default — which for base_url is
// window.location.origin, i.e. it appears to work.
type uiConfig struct {
	BaseURL   string `json:"base_url"`
	ProjectID string `json:"project_id"`

	// AuthToken is always empty, and is emitted rather than omitted.
	//
	// The bundle reads it and falls back to `import.meta.env.VITE_AUTH_TOKEN`
	// when the key is ABSENT — a build-time value that would be baked into the
	// asset. Emitting an explicit empty string is what stops that fallback.
	// The page is served same-origin behind this handler, so the browser's own
	// session cookie authenticates every call and no token belongs in the DOM.
	AuthToken string `json:"auth_token"`
}

// NewHandler builds the SPA route.
func NewHandler(
	cfg Config,
	authConfig apimw.AuthConfig,
	permissions auth.PermissionResolver,
) (*Handler, error) {
	// The same nil-validator check every route in this service makes. A route
	// serves perfectly well without a validator; it just does not
	// authenticate, and that is invisible at runtime.
	if authConfig.PrincipalValidator == nil ||
		authConfig.ForwardedIdentityVerifier == nil ||
		permissions == nil {
		return nil, ErrInvalidHandler
	}
	if strings.TrimSpace(cfg.StaticDir) == "" {
		return nil, fmt.Errorf("%w: no bundle directory", ErrInvalidHandler)
	}
	if cfg.APIBase == "" {
		cfg.APIBase = "/api/v2"
	}

	handler := &Handler{cfg: cfg}

	projectFromPath := func(request *http.Request) (string, bool) {
		projectID := chi.URLParam(request, "project_id")
		return projectID, validProjectID(projectID)
	}
	guard := func(next http.Handler) http.Handler {
		return apimw.Auth(authConfig)(
			apimw.RequireResolvedPermissionsForProject(
				permissions, deepwiki.Mode, projectFromPath, deepwiki.ReadPermission,
			)(next))
	}

	router := chi.NewRouter()

	// Assets are NOT behind the permission gate, and that is deliberate.
	//
	// They are a public JavaScript bundle: the same bytes for every caller,
	// carrying no project data and no identity. Gating them would mean
	// resolving permissions for every chunk request — dozens per page load,
	// each a database round trip — to protect content that is already
	// downloadable by anyone the page renders for. The page itself carries the
	// identity, and that is what is gated.
	assetsDir := filepath.Join(cfg.StaticDir, "assets")
	router.Handle(BasePath+"/assets/*",
		http.StripPrefix(BasePath+"/assets/", http.FileServer(http.Dir(assetsDir))))

	router.Method(http.MethodGet, ProjectPath, guard(http.HandlerFunc(handler.serveSPA)))
	// The SPA is a single page with client-side routes under the project, so
	// every deeper path renders the same document.
	router.Method(http.MethodGet, ProjectPath+"/*", guard(http.HandlerFunc(handler.serveSPA)))

	handler.handler = router
	return handler, nil
}

// ServeHTTP answers even for a zero handler, so a mount that half-happened
// returns a readable 503 rather than taking the process down.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.handler == nil {
		http.Error(w, "DeepWiki is not enabled in this deployment.",
			http.StatusServiceUnavailable)
		return
	}
	h.handler.ServeHTTP(w, r)
}

func (h *Handler) serveSPA(w http.ResponseWriter, r *http.Request) {
	cfg := uiConfig{
		BaseURL:   "",
		ProjectID: chi.URLParam(r, "project_id"),
		AuthToken: "",
	}

	// base_url is EMPTY, meaning "this origin".
	//
	// The bundle builds its API URLs as `${baseUrl}/api/v2/...`, so an empty
	// base yields a relative path and the browser resolves it against the page
	// — which is this service. Naming an absolute origin here would work until
	// the deployment is reached through a different hostname, and would then
	// send the session cookie somewhere it does not belong.
	payload, err := json.Marshal(cfg)
	if err != nil {
		http.Error(w, "The DeepWiki page could not be rendered.",
			http.StatusInternalServerError)
		return
	}

	indexHTML := h.loadIndex()

	// The bundle is built with an absolute base, so its asset URLs are already
	// correct and need no rewriting — unlike the admin console, whose bundle
	// is built relative. Asserted rather than assumed: a bundle rebuilt with a
	// relative base would silently 404 its own JavaScript, and the page would
	// render an empty root div with no error anywhere.
	if strings.Contains(indexHTML, `="./assets`) {
		http.Error(w,
			"The DeepWiki bundle was built with a relative base and cannot be served from this path.",
			http.StatusInternalServerError)
		return
	}

	// A BARE object literal, not JSON.parse('...').
	//
	// The quoted form was a critical script-injection hole in the admin
	// handler (CodeQL go/unsafe-quoting): one quote in the payload closes the
	// string early and the rest executes. Two properties make this form safe,
	// and both matter — there is no string literal to break out of, and
	// encoding/json escapes <, > and & by default, so a payload containing
	// "</script>" cannot terminate the enclosing tag. Do NOT switch to a
	// json.Encoder with SetEscapeHTML(false).
	inlineConfigScript := "window.deepwiki_ui_config = " + string(payload) + ";"
	indexHTML = strings.Replace(indexHTML, "<!-- deepwiki_ui_config -->",
		"<script>"+inlineConfigScript+"</script>", 1)

	// Per-project and behind a permission check, so it must not be replayed to
	// someone else. no-store rather than private/no-cache: there is nothing
	// here worth revalidating, and it is what every other identity-bearing
	// response in this service sets.
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Content-Security-Policy", spaContentSecurityPolicy(inlineConfigScript))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprint(w, indexHTML)
}

// spaContentSecurityPolicy builds the policy for one rendered page.
//
// WHAT IT DOES NOT DO, stated first: it does not defend the one inline script
// this handler emits against a payload injected INTO that script. The hash
// covers the bytes served, so an injected payload is inside the hashed block
// and runs. The JSON escaping above is what closes that, and its own test is
// what keeps it closed.
//
// What it does do is deny every OTHER script: a second inline element
// reflected into the page has a different hash, and `script-src 'self'` denies
// a foreign origin so a loader cannot fetch its payload from elsewhere.
//
// TWO DIRECTIVES DIFFER FROM THE ADMIN CONSOLE'S, and both are this bundle's
// dependencies rather than a relaxation:
//
//   - `worker-src blob:` — mermaid renders diagrams in a worker created from a
//     blob URL. Without it every diagram in a generated wiki fails to render,
//     which is most of what this page exists to show.
//   - `img-src` already allows data: and blob:, which is what mermaid's SVG
//     export and the code-block copy path produce.
//
// `connect-src 'self'` is the one that matters most here: script running in
// this page can reach the facade with the user's session, and with no route
// off the origin there is nowhere to send what it reads.
func spaContentSecurityPolicy(inlineScript string) string {
	digest := sha256.Sum256([]byte(inlineScript))
	return strings.Join([]string{
		"default-src 'self'",
		"base-uri 'none'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"form-action 'self'",
		"script-src 'self' 'sha256-" + base64.StdEncoding.EncodeToString(digest[:]) + "'",
		// Emotion (MUI's styling engine) injects <style> elements at runtime;
		// that is a styling channel, not a script one.
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"connect-src 'self'",
		"worker-src 'self' blob:",
	}, "; ")
}

func (h *Handler) loadIndex() string {
	h.indexOnce.Do(func() {
		data, err := os.ReadFile(filepath.Join(h.cfg.StaticDir, "index.html"))
		if err != nil {
			// A body that names the cause. The admin handler's equivalent says
			// only "not found", and an operator who has mounted the wrong
			// directory learns nothing from it.
			h.indexHTML = "<!doctype html><html><body>" +
				"The DeepWiki bundle is not present in this image." +
				"</body></html>"
			return
		}
		h.indexHTML = string(data)
	})
	return h.indexHTML
}

// validProjectID accepts only a positive decimal id, matching the facade's own
// check: the value reaches the permission resolver, and a non-numeric one must
// be rejected before it gets there.
func validProjectID(raw string) bool {
	if raw == "" || (strings.HasPrefix(raw, "0") && raw != "0") {
		return false
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	return err == nil && value > 0
}
