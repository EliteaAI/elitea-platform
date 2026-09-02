// Package inventory is the elitea-main facade for the Inventory provider
// service — the SECOND provider, and the falsification test for ADR-0012's
// runner generalisation.
//
// ADR-0012 set the measure before the work: this facade must fit in ≤8 files
// and ≤250 net non-test lines outside values.yaml. Over budget means the
// generalisation did not land, and the fix belongs in the shared packages
// rather than here. The number is at the bottom of this comment because it is
// the point of the file.
//
// WHAT INVENTORY NEEDS THAT DEEPWIKI DOES NOT: nothing. It speaks the same SPI
// — its legacy plugin has the same methods/descriptor.py, the same five routes,
// and its recorded descriptor has the same four top-level keys (captured at
// conformance/provider/fixtures/inventory/).
//
// WHAT DEEPWIKI NEEDS THAT INVENTORY DOES NOT, and which is therefore correctly
// absent here: repository credential resolution out of the project vault, the
// git-host egress allowlist, and the minted callback token. Inventory clones
// nothing and calls nothing back. A "generic" facade that carried those would
// have made this file longer, not shorter.
package inventory

import (
	"errors"
	"log/slog"
	"net/http"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/facade"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/proxy"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/routes"
)

// Mode is the permission mode these routes resolve in. Inventory's legacy
// plugin authorised by the provider hop, so like DeepWiki's these grants are
// chosen rather than recovered — see migration 0108.
const Mode = "default"

const (
	// ReadPermission gates the capacity and invocation reads.
	ReadPermission = "models.applications.inventory.read"
	// InvokePermission gates starting and cancelling an invocation.
	InvokePermission = "models.applications.inventory.invoke"
)

// EnvNames are Inventory's own variables. Spelled out rather than built from a
// prefix: every one appears in a chart and in the env-drift allowlist, and both
// are searched by the literal string.
var EnvNames = facade.EnvNames{
	Enabled:        "ELITEA_INVENTORY_ENABLED",
	BaseURL:        "ELITEA_INVENTORY_BASE_URL",
	ClientCertFile: "ELITEA_INVENTORY_CLIENT_CERT_FILE",
	ClientKeyFile:  "ELITEA_INVENTORY_CLIENT_KEY_FILE",
	CAFile:         "ELITEA_INVENTORY_CA_FILE",
	ServerName:     "ELITEA_INVENTORY_SERVER_NAME",
	IdentitySecret: "ELITEA_INVENTORY_IDENTITY_SECRET",
	Timeout:        "ELITEA_INVENTORY_TIMEOUT_SECONDS",
}

// ErrInvalidRoute reports a facade that cannot be composed.
var ErrInvalidRoute = errors.New("invalid Inventory route")

// The facade's own paths. They carry {project_id} because the permission gate
// resolves against it; the provider's own paths do not, because the project
// travels in the signed identity headers.
const (
	SlotsPath      = "/inventory/slots/{project_id}"
	InvokePath     = "/inventory/tools/{project_id}/{toolkit_name}/{tool_name}/invoke"
	InvocationPath = "/inventory/invocations/{project_id}/{toolkit_name}/{tool_name}/{invocation_id}"
)

// Route serves the Inventory facade.
type Route struct{ handler http.Handler }

// NewRoute mounts the three SPI paths behind their permissions.
func NewRoute(
	cfg facade.Config,
	authConfig apimw.AuthConfig,
	permissions auth.PermissionResolver,
	logger *slog.Logger,
) (*Route, error) {
	if !facade.Composable(authConfig, permissions) {
		return nil, ErrInvalidRoute
	}
	hop, err := proxy.New(cfg, EnvNames.BaseURL, logger)
	if err != nil {
		return nil, err
	}
	handler, err := routes.Build(routes.Table{
		SlotsPath:        SlotsPath,
		InvokePath:       InvokePath,
		InvocationPath:   InvocationPath,
		Mode:             Mode,
		ReadPermission:   ReadPermission,
		InvokePermission: InvokePermission,
		Auth:             authConfig,
		Permissions:      permissions,
		Forward:          hop.Forward,
		Admission:        cfg.Admission,
	})
	if err != nil {
		return nil, ErrInvalidRoute
	}
	return &Route{handler: handler}, nil
}

// ServeHTTP answers even for a zero Route, so a mount that half-happened
// returns a readable 503 rather than taking the process down.
func (route *Route) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if route == nil || route.handler == nil {
		http.Error(w, "Inventory is not enabled in this deployment.", http.StatusServiceUnavailable)
		return
	}
	route.handler.ServeHTTP(w, r)
}
