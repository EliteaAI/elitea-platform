package deepwikiui_test

// The vendored SPA's handler.
//
// The assertions worth reading first are the two that exist because the admin
// console shipped the defect: TestTheConfigInjectionCannotBreakOutOfTheScript
// (a critical script-injection hole, CodeQL go/unsafe-quoting) and
// TestThePageIsNotCacheable (an identity-bearing page a shared cache could
// replay to the next person). This handler inherits both fixes by reproducing
// the shape, and these keep them.

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	deepwiki "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/deepwiki"
	deepwikiui "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/deepwikiui"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

type principalValidatorFunc func(context.Context, auth.User) (auth.User, error)

func (f principalValidatorFunc) ValidatePrincipal(ctx context.Context, user auth.User) (auth.User, error) {
	return f(ctx, user)
}

type forwardedPeerVerifierFunc func(*http.Request) error

func (f forwardedPeerVerifierFunc) VerifyForwardedIdentityPeer(request *http.Request) error {
	return f(request)
}

type permissionResolverFunc func(context.Context, auth.User, string, string) (auth.PermissionResolution, error)

func (f permissionResolverFunc) ResolvePermissions(ctx context.Context, user auth.User, mode, projectID string) (auth.PermissionResolution, error) {
	return f(ctx, user, mode, projectID)
}

func authConfig() apimw.AuthConfig {
	return apimw.AuthConfig{
		PrincipalValidator: principalValidatorFunc(
			func(_ context.Context, user auth.User) (auth.User, error) { return user, nil }),
		ForwardedIdentityVerifier: forwardedPeerVerifierFunc(
			func(*http.Request) error { return nil }),
	}
}

func resolver(granted ...string) auth.PermissionResolver {
	return permissionResolverFunc(
		func(_ context.Context, _ auth.User, _, _ string) (auth.PermissionResolution, error) {
			return auth.PermissionResolution{UserID: 11, Permissions: granted}, nil
		})
}

// bundle writes a minimal built bundle: an index.html carrying the injection
// marker and absolute asset paths, plus one asset.
func bundle(t *testing.T, indexHTML string) string {
	t.Helper()
	dir := t.TempDir()
	if indexHTML == "" {
		indexHTML = `<!doctype html><html><head>` +
			`<!-- deepwiki_ui_config -->` +
			`<script type="module" src="/app/deepwiki/assets/index.js"></script>` +
			`</head><body><div id="root"></div></body></html>`
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte(indexHTML), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "index.js"),
		[]byte("console.log('deepwiki')"), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func handlerOver(t *testing.T, dir string, granted ...string) *deepwikiui.Handler {
	t.Helper()
	built, err := deepwikiui.NewHandler(
		deepwikiui.Config{StaticDir: dir}, authConfig(), resolver(granted...))
	if err != nil {
		t.Fatal(err)
	}
	return built
}

func get(t *testing.T, handler http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Header.Set("X-Auth-Type", "user")
	request.Header.Set("X-Auth-ID", "11")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

// ---------------------------------------------------------------------------
// the injection
// ---------------------------------------------------------------------------

func TestTheConfigReachesThePageUnderTheKeysTheBundleReads(t *testing.T) {
	response := get(t, handlerOver(t, bundle(t, ""), deepwiki.ReadPermission),
		"/app/deepwiki/7")
	if response.Code != http.StatusOK {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	body := response.Body.String()

	if !strings.Contains(body, "window.deepwiki_ui_config = {") {
		t.Fatalf("no config object in the page: %s", body)
	}
	// LOWER-CASE keys. getEnvVar() lower-cases the name it looks up, so a
	// capitalised key is one the SPA never finds — and it then falls back to a
	// default that makes the page appear to work.
	for _, key := range []string{`"base_url"`, `"project_id"`, `"auth_token"`} {
		if !strings.Contains(body, key) {
			t.Fatalf("the config carries no %s: %s", key, body)
		}
	}
	if !strings.Contains(body, `"project_id":"7"`) {
		t.Fatalf("the project from the path is not injected: %s", body)
	}
	// Empty base_url means "this origin", so the SPA builds relative URLs and
	// the browser resolves them against the page. An absolute origin would
	// work until the deployment answered on a second hostname.
	if !strings.Contains(body, `"base_url":""`) {
		t.Fatalf("base_url is not empty: %s", body)
	}
	// Explicitly empty, not absent: an ABSENT key makes the bundle fall back
	// to a build-time VITE_AUTH_TOKEN baked into the asset.
	if !strings.Contains(body, `"auth_token":""`) {
		t.Fatalf("auth_token is not an explicit empty string: %s", body)
	}
}

// The defect the admin console shipped, in this handler's own terms.
//
// A quoted injection (`JSON.parse('...')`) lets one apostrophe in the payload
// close the string early and execute the rest. The bare object literal has no
// string to break out of, and encoding/json escapes <, > and & so a payload
// containing "</script>" cannot terminate the tag.
func TestTheConfigInjectionCannotBreakOutOfTheScript(t *testing.T) {
	// The project id is the only caller-controlled value that reaches the
	// payload, and the route already refuses a non-numeric one — so this
	// asserts the ENCODING rather than relying on that check, because the
	// encoding is what protects any field added later.
	response := get(t, handlerOver(t, bundle(t, ""), deepwiki.ReadPermission),
		"/app/deepwiki/7")
	body := response.Body.String()

	if strings.Contains(body, "JSON.parse(") {
		t.Fatal("the config is injected as a quoted string; one apostrophe in the payload executes the rest")
	}
	// The escaping must be ON. A json.Encoder with SetEscapeHTML(false) would
	// pass every other assertion here and silently reopen the tag-breakout.
	if strings.Contains(body, `"<`) && !strings.Contains(body, `<`) {
		t.Fatalf("HTML escaping appears to be off: %s", body)
	}
}

func TestANonNumericProjectNeverReachesTheResolver(t *testing.T) {
	reached := false
	built, err := deepwikiui.NewHandler(
		deepwikiui.Config{StaticDir: bundle(t, "")},
		authConfig(),
		permissionResolverFunc(func(context.Context, auth.User, string, string) (auth.PermissionResolution, error) {
			reached = true
			return auth.PermissionResolution{}, nil
		}))
	if err != nil {
		t.Fatal(err)
	}
	for _, projectID := range []string{"abc", "0", "-1", "01", "7;drop"} {
		if response := get(t, built, "/app/deepwiki/"+projectID); response.Code == http.StatusOK {
			t.Fatalf("project %q was served", projectID)
		}
	}
	if reached {
		t.Fatal("an invalid project id reached the permission resolver")
	}
}

// ---------------------------------------------------------------------------
// the response headers
// ---------------------------------------------------------------------------

// The page is per-project and behind a permission check. With no directive, a
// shared proxy or the browser's own disk cache may replay it after a logout or
// to the next person on the machine.
func TestThePageIsNotCacheable(t *testing.T) {
	response := get(t, handlerOver(t, bundle(t, ""), deepwiki.ReadPermission),
		"/app/deepwiki/7")
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control %q", got)
	}
}

func TestTheContentSecurityPolicyAuthorisesExactlyTheInjectedScript(t *testing.T) {
	response := get(t, handlerOver(t, bundle(t, ""), deepwiki.ReadPermission),
		"/app/deepwiki/7")
	policy := response.Header().Get("Content-Security-Policy")
	if policy == "" {
		t.Fatal("no Content-Security-Policy")
	}

	// The hash is derived from the response, never restated as a constant, so
	// it cannot drift away from the script it authorises — which is how a
	// hash-based policy usually rots into a blank page. Recompute it here from
	// the body and require a match.
	body := response.Body.String()
	start := strings.Index(body, "<script>") + len("<script>")
	end := strings.Index(body, "</script>")
	if start <= 0 || end <= start {
		t.Fatalf("no inline script in the page: %s", body)
	}
	inline := body[start:end]
	if !strings.Contains(policy, expectedHash(inline)) {
		t.Fatalf("the policy does not authorise the script it served.\npolicy: %s\nscript: %s",
			policy, inline)
	}

	if strings.Contains(policy, "'unsafe-inline'") &&
		strings.Contains(policyDirective(policy, "script-src"), "'unsafe-inline'") {
		t.Fatalf("script-src allows unsafe-inline, so the hash buys nothing: %s", policy)
	}
	// mermaid renders diagrams in a worker created from a blob URL. Without
	// this every diagram in a generated wiki fails to render, which is most of
	// what the page exists to show.
	if !strings.Contains(policyDirective(policy, "worker-src"), "blob:") {
		t.Fatalf("worker-src does not allow blob:, so mermaid cannot render: %s", policy)
	}
	// The exfiltration leg. Script in this page can reach the facade with the
	// user's session; with no route off the origin, reading it is worth much
	// less.
	if policyDirective(policy, "connect-src") != "connect-src 'self'" {
		t.Fatalf("connect-src is not 'self' only: %s", policy)
	}
	for _, required := range []string{"base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'"} {
		if !strings.Contains(policy, required) {
			t.Fatalf("the policy is missing %q: %s", required, policy)
		}
	}
}

func TestNosniffIsSet(t *testing.T) {
	response := get(t, handlerOver(t, bundle(t, ""), deepwiki.ReadPermission),
		"/app/deepwiki/7")
	if response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("nosniff is not set; a content-sniffed asset undoes part of the policy")
	}
}

// ---------------------------------------------------------------------------
// authorization
// ---------------------------------------------------------------------------

// The page gate is the SAME permission the facade's /slots requires, so the
// page and its very first call agree. A page that renders and then 403s on
// every request is worse than one that refuses.
func TestThePageRequiresTheSameReadGrantAsTheFacade(t *testing.T) {
	response := get(t, handlerOver(t, bundle(t, "")), "/app/deepwiki/7")
	if response.Code != http.StatusForbidden {
		t.Fatalf("a caller with no grant got %d", response.Code)
	}

	response = get(t, handlerOver(t, bundle(t, ""), deepwiki.ReadPermission), "/app/deepwiki/7")
	if response.Code != http.StatusOK {
		t.Fatalf("a caller with the read grant got %d", response.Code)
	}
}

func TestAnUnauthenticatedCallerIsRefused(t *testing.T) {
	handler := handlerOver(t, bundle(t, ""), deepwiki.ReadPermission)
	request := httptest.NewRequest(http.MethodGet, "/app/deepwiki/7", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code == http.StatusOK {
		t.Fatal("an unauthenticated request was served the page")
	}
}

// Assets are public bytes and are NOT gated: the same JavaScript for every
// caller, no project data, no identity. Gating them would mean a permission
// resolution per chunk — dozens per page load — to protect content anyone the
// page renders for can already download.
func TestAssetsAreServedWithoutAPermissionCheck(t *testing.T) {
	handler := handlerOver(t, bundle(t, ""))
	request := httptest.NewRequest(http.MethodGet, "/app/deepwiki/assets/index.js", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("assets are gated: %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "deepwiki") {
		t.Fatalf("the asset was not served: %q", response.Body.String())
	}
}

// A client-side route under the project renders the same document, so a
// bookmarked wiki reopens instead of 404ing.
func TestDeepLinksRenderTheSameDocument(t *testing.T) {
	response := get(t, handlerOver(t, bundle(t, ""), deepwiki.ReadPermission),
		"/app/deepwiki/7/wikis/some-wiki")
	if response.Code != http.StatusOK {
		t.Fatalf("a deep link got %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "window.deepwiki_ui_config") {
		t.Fatal("a deep link rendered a page with no injected config")
	}
}

// ---------------------------------------------------------------------------
// composition and bundle sanity
// ---------------------------------------------------------------------------

func TestCompositionRefusesAHalfWiredHandler(t *testing.T) {
	dir := bundle(t, "")
	full := authConfig()

	cases := map[string]struct {
		cfg  deepwikiui.Config
		auth apimw.AuthConfig
		res  auth.PermissionResolver
	}{
		"no principal validator": {deepwikiui.Config{StaticDir: dir},
			apimw.AuthConfig{ForwardedIdentityVerifier: full.ForwardedIdentityVerifier}, resolver()},
		"no forwarded verifier": {deepwikiui.Config{StaticDir: dir},
			apimw.AuthConfig{PrincipalValidator: full.PrincipalValidator}, resolver()},
		"no resolver":  {deepwikiui.Config{StaticDir: dir}, full, nil},
		"no directory": {deepwikiui.Config{}, full, resolver()},
	}
	for name, testCase := range cases {
		if _, err := deepwikiui.NewHandler(testCase.cfg, testCase.auth, testCase.res); !errors.Is(
			err, deepwikiui.ErrInvalidHandler) {
			t.Fatalf("%s was accepted: %v", name, err)
		}
	}
}

func TestAZeroHandlerRefusesInsteadOfPanicking(t *testing.T) {
	response := get(t, &deepwikiui.Handler{}, "/app/deepwiki/7")
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503", response.Code)
	}
	var absent *deepwikiui.Handler
	if response := get(t, absent, "/app/deepwiki/7"); response.Code != http.StatusServiceUnavailable {
		t.Fatalf("nil handler: %d", response.Code)
	}
}

// A bundle built with a RELATIVE base resolves its assets against the deep
// path it was loaded from, where nothing is served: the page renders an empty
// root div and reports nothing anywhere. Refusing is how that becomes visible.
func TestARelativeBundleIsRefusedRatherThanServedBroken(t *testing.T) {
	dir := bundle(t, `<!doctype html><html><head><!-- deepwiki_ui_config -->`+
		`<script type="module" src="./assets/index.js"></script></head><body></body></html>`)
	response := get(t, handlerOver(t, dir, deepwiki.ReadPermission), "/app/deepwiki/7")
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("a relative bundle was served: %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "relative base") {
		t.Fatalf("the error does not name the cause: %s", response.Body.String())
	}
}

// A missing bundle says which bundle is missing. "Not found" would leave an
// operator who mounted the wrong directory with nothing to go on.
func TestAMissingBundleSaysSo(t *testing.T) {
	dir := t.TempDir()
	response := get(t, handlerOver(t, dir, deepwiki.ReadPermission), "/app/deepwiki/7")
	if !strings.Contains(response.Body.String(), "not present in this image") {
		t.Fatalf("unhelpful body: %s", response.Body.String())
	}
}

// The served path must match the bundle's compiled-in base, or the page loads
// and then 404s on its own JavaScript.
func TestTheBasePathMatchesTheViteBase(t *testing.T) {
	if deepwikiui.BasePath != "/app/deepwiki" {
		t.Fatalf("BasePath is %q; apps/deepwiki-ui/vite.config.js compiles /app/deepwiki/ into every asset URL",
			deepwikiui.BasePath)
	}
}

func policyDirective(policy, name string) string {
	for _, directive := range strings.Split(policy, "; ") {
		if strings.HasPrefix(directive, name+" ") {
			return directive
		}
	}
	return ""
}

// expectedHash recomputes the CSP hash from the served script, so this test
// cannot pass against a policy that authorises something else.
func expectedHash(inlineScript string) string {
	digest := sha256.Sum256([]byte(inlineScript))
	return "'sha256-" + base64.StdEncoding.EncodeToString(digest[:]) + "'"
}
