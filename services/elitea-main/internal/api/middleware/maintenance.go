package middleware

// Maintenance mode — the enforcement half of the admin Configuration page's
// Maintenance section.
//
// # What this replaces
//
// pylon installed a gevent ROUTER HOOK on the bootstrap plugin's persisted
// state (legacy/plugins/bootstrap/tools/splash.py). It ran in front of
// everything, resolved the caller over the auth RPC, read their
// administration-mode roles, and served a stored HTML splash with 503 to anyone
// who was not an admin. Nothing in this service installs router hooks, and the
// Configuration section that toggled it therefore said so and refused.
//
// This middleware is the port. It answers the same question — is maintenance on,
// and is this caller an administrator — of the same permission model, and it
// answers 503 to everyone else.
//
// # Why it sits on the JSON API and not in front of the whole process
//
// The pylon hook had to intercept everything because pylon also served the SPA's
// assets, so a maintenance window meant the browser got the splash HTML instead
// of the app. Here the SPA is static and is served outside this group. Letting
// it load and having it render the splash itself is strictly better:
//
//   - the splash is themed, translated and accessible like the rest of the
//     product, rather than being an HTML document an operator pastes into a
//     textarea (which is also an XSS surface pointed at every user, and is why
//     `splash_template` is not ported);
//   - an ADMIN can reach the admin panel and turn the switch back off during the
//     window, which under the pylon hook depended on a static shared bypass
//     token in plugin config;
//   - the SPA discovers maintenance from `platform_settings` rather than by
//     inferring it from a wall of failed requests.
//
// # The allowlist, entry by entry
//
// Everything under `/api/v2` is refused to a non-admin EXCEPT:
//
//   - `/api/v2/auth/**` and `/api/v2/scim/**` — a maintenance window must not
//     lock out the sign-in an administrator needs in order to end it. This is
//     the same reason splash.py carried `splash_auth_allowlist`.
//   - `/api/v2/admin/**` — the admin surface itself. It is NOT open: every route
//     under it carries its own permission gate, so a non-admin who reaches it
//     gets 403 from the gate rather than 503 from here. Skipping it costs
//     nothing and removes the ordering hazard of a maintenance switch that can
//     refuse the page that turns it off.
//   - `/api/v2/elitea_core/platform_settings/**` — how the SPA learns it is in
//     a maintenance window at all. Refusing this would leave the client with no
//     way to tell maintenance from an outage, which is the state this whole
//     feature exists to make legible.
//
// Health endpoints need no entry: they are not mounted under `/api/v2`.
//
// # Failure is permissive, and that direction is chosen
//
// A store this middleware cannot read yields "not in maintenance". The opposite
// default would turn a database hiccup into a platform-wide outage that no
// operator asked for and that the admin panel — also unreachable — could not
// clear. A maintenance window that fails to engage is visible and recoverable;
// one that engages by accident is neither.
//
// # The cache exists because this is on EVERY request
//
// `platformconfig` is deliberately cache-free: its reads are per-request so an
// admin save takes effect on the next call rather than the next deployment.
// That argument holds for a handful of handlers and not for a middleware in
// front of the entire API, where it would add a query to every request the
// platform serves for the sake of a row that changes a few times a year.
//
// So the resolved state is held for maintenanceCacheTTL. The TTL is a compiled
// constant rather than configuration: an operator cannot make it long enough to
// be surprising, and the bound on "how long after I flip the switch does it take
// effect" is a fixed, statable number. Entering and leaving maintenance are both
// delayed by at most that window, which is the honest trade and is why the
// number is small.

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/platformconfig"
)

// maintenanceCacheTTL bounds how stale the switch may be. See the file doc.
const maintenanceCacheTTL = 10 * time.Second

// MaintenanceAdminPermission is the permission that gets through a maintenance
// window. It is `runtime.plugins` — the name pylon's own maintenance.py declares
// on this surface, and the one the Configuration section requires in order to
// author the switch. A caller who cannot START a window is not admitted during
// one; a caller who can, is.
const MaintenanceAdminPermission = "runtime.plugins"

// maintenanceAllowlist are the `/api/v2` path prefixes maintenance never
// refuses. See the file doc for why each is here.
var maintenanceAllowlist = []string{
	"/api/v2/auth",
	"/api/v2/scim",
	"/api/v2/admin",
	"/api/v2/elitea_core/platform_settings",
}

// MaintenanceConfig wires the middleware.
type MaintenanceConfig struct {
	// Pool reads the switch. A nil pool disables the middleware entirely — the
	// permissive default, stated at the composition root rather than discovered
	// per request.
	Pool *pgxpool.Pool
	// Resolver decides who is an administrator. A nil resolver would make the
	// window refuse EVERYONE including administrators, so it disables the
	// middleware for the same reason a nil pool does: a maintenance mode nobody
	// can leave is worse than one that never engages.
	Resolver auth.PermissionResolver
	// now is injectable so the cache TTL is testable without sleeping.
	now func() time.Time
}

// maintenanceGate holds the cached switch state.
//
// It takes the STORE READ as a function rather than the pool, so the cache
// semantics — the TTL, and what a failed refresh does to a running window — are
// testable without a database. Those are the parts with a decision in them; the
// query itself belongs to platformconfig and is covered there.
type maintenanceGate struct {
	load     func(context.Context) (platformconfig.Maintenance, error)
	resolver auth.PermissionResolver
	now      func() time.Time

	mu        sync.Mutex
	state     platformconfig.Maintenance
	expiresAt time.Time
}

// Maintenance returns the middleware. A configuration missing either dependency
// returns a pass-through, so a deployment that has not wired it is not silently
// half-enforcing.
func Maintenance(config MaintenanceConfig) func(http.Handler) http.Handler {
	if config.Pool == nil || config.Resolver == nil {
		return func(next http.Handler) http.Handler { return next }
	}
	pool := config.Pool
	gate := &maintenanceGate{
		load: func(ctx context.Context) (platformconfig.Maintenance, error) {
			return platformconfig.LoadMaintenance(ctx, pool)
		},
		resolver: config.Resolver,
		now:      config.now,
	}
	return gate.middleware
}

func (g *maintenanceGate) clock() time.Time {
	if g.now == nil {
		return time.Now()
	}
	return g.now()
}

// resolve returns the cached switch, refreshing it when the TTL has expired.
//
// A refresh that FAILS keeps the previous value and re-arms the TTL rather than
// falling back to "off". Two reasons: a running maintenance window must not end
// because one query timed out, and re-querying a failing database on every
// request for the duration of the outage is the retry storm this cache exists
// to prevent. The very first read on a cold cache has no previous value, and
// there the zero state — not in maintenance — is the permissive default the
// file doc chooses.
func (g *maintenanceGate) resolve(ctx context.Context) platformconfig.Maintenance {
	g.mu.Lock()
	defer g.mu.Unlock()

	now := g.clock()
	if now.Before(g.expiresAt) {
		return g.state
	}
	g.expiresAt = now.Add(maintenanceCacheTTL)

	state, err := g.load(ctx)
	if err != nil {
		slog.WarnContext(ctx, "maintenance state unreadable; keeping the last known value",
			"error", err, "enabled", g.state.Enabled)
		return g.state
	}
	g.state = state
	return g.state
}

func (g *maintenanceGate) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if maintenanceExempt(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		state := g.resolve(r.Context())
		if !state.Enabled {
			next.ServeHTTP(w, r)
			return
		}

		if g.isAdministrator(r) {
			next.ServeHTTP(w, r)
			return
		}

		writeMaintenance(w, state)
	})
}

// isAdministrator resolves the caller's administration-mode permissions.
//
// An UNAUTHENTICATED caller is not an administrator and is refused — the
// window's whole purpose. A resolver ERROR is also refused rather than admitted:
// unlike the switch itself, where permissiveness protects users from an
// accidental outage, permissiveness here would admit every caller to a platform
// an operator has deliberately closed, which is the failure the operator was
// preventing.
func (g *maintenanceGate) isAdministrator(r *http.Request) bool {
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		return false
	}
	resolution, err := g.resolver.ResolvePermissions(
		r.Context(), user, auth.PermissionModeAdministration, "",
	)
	if err != nil {
		return false
	}
	for _, granted := range resolution.Permissions {
		if granted == MaintenanceAdminPermission {
			return true
		}
	}
	return false
}

// maintenanceExempt matches a path against the allowlist on SEGMENT boundaries.
//
// `strings.HasPrefix` alone would exempt `/api/v2/administration_of_secrets`
// because it starts with `/api/v2/admin`. A prefix match on a URL path is the
// classic way an allowlist grows a hole that no test names, so the boundary is
// checked explicitly: the path must equal the prefix or continue with `/`.
func maintenanceExempt(path string) bool {
	for _, prefix := range maintenanceAllowlist {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			return true
		}
	}
	return false
}

// writeMaintenance answers the refusal.
//
// 503 with `Retry-After` is the correct status for a deliberate, temporary
// refusal, and it is what the reference served. The body carries the operator's
// own words so a non-browser client — the SDK, a CI job, a webhook — reports
// something an operator can act on instead of a bare status. `maintenance: true`
// is the discriminator clients match on: 503 alone is also what an overloaded
// gateway returns.
func writeMaintenance(w http.ResponseWriter, state platformconfig.Maintenance) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Retry-After", "120")
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"maintenance": true,
		"title":       state.Title,
		"message":     state.Message,
		"error":       state.Title,
	})
}
