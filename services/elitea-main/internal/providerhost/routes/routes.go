// Package routes is the provider facade's route table: the three paths and
// four methods every facade mounts, each behind the same authentication and
// per-project permission guard, each forwarding to the SPI path the provider
// serves. DeepWiki and Inventory carried this table twice, line for line
// (ADR-0023 context); a third facade would have carried it a third time.
//
// What a facade still owns: its path patterns (the parity gate and the
// router name them), its permission strings and mode, its hop, and — for
// DeepWiki — an invoke handler that rewrites the body before forwarding.
package routes

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/facade"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/spi"
)

// ErrIncompleteTable is returned for a table that cannot serve: a missing
// path, permission or hop, or a credential set that authenticates nobody.
var ErrIncompleteTable = errors.New("incomplete provider facade route table")

// Forwarder is the hop: providerhost/proxy's Forward, or a test's recorder.
type Forwarder func(w http.ResponseWriter, r *http.Request, providerPath, projectID, userID string)

// Table describes one facade's routes.
type Table struct {
	// The facade's own path patterns, each carrying {project_id}; Invoke and
	// Invocation also carry {toolkit_name} and {tool_name}, Invocation
	// {invocation_id} as well.
	SlotsPath, InvokePath, InvocationPath string
	// The permission mode and the two permissions: reading (slots, polling)
	// and invoking (starting, cancelling). Polling and cancelling share a
	// path and do NOT share a permission.
	Mode, ReadPermission, InvokePermission string
	Auth                                   apimw.AuthConfig
	Permissions                            auth.PermissionResolver
	// Forward is the hop every route ends in.
	Forward Forwarder
	// Invoke, when set, serves POST InvokePath instead of a plain forward —
	// DeepWiki rewrites the body (credentials, the callback grant) first.
	// It runs behind the same guard.
	Invoke http.HandlerFunc
	// UserID resolves the acting user for the signed identity headers;
	// nil means facade.UserID.
	UserID func(*http.Request) string
}

// Build returns the table's handler, or ErrIncompleteTable.
func Build(t Table) (http.Handler, error) {
	if t.SlotsPath == "" || t.InvokePath == "" || t.InvocationPath == "" ||
		t.Mode == "" || t.ReadPermission == "" || t.InvokePermission == "" ||
		t.Forward == nil || !facade.Composable(t.Auth, t.Permissions) {
		return nil, ErrIncompleteTable
	}
	userID := t.UserID
	if userID == nil {
		userID = facade.UserID
	}
	guard := func(permission string) func(http.Handler) http.Handler {
		return facade.Guard(t.Auth, t.Permissions, t.Mode, permission)
	}
	forward := func(providerPath func(*http.Request) string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Forward(w, r, providerPath(r), chi.URLParam(r, "project_id"), userID(r))
		})
	}
	invoke := forward(func(r *http.Request) string {
		return spi.InvokePath(chi.URLParam(r, "toolkit_name"), chi.URLParam(r, "tool_name"))
	})
	if t.Invoke != nil {
		invoke = t.Invoke
	}
	router := chi.NewRouter()
	router.Method(http.MethodGet, t.SlotsPath,
		guard(t.ReadPermission)(forward(func(*http.Request) string { return spi.SlotsPath })))
	router.Method(http.MethodPost, t.InvokePath, guard(t.InvokePermission)(invoke))
	router.Method(http.MethodGet, t.InvocationPath, guard(t.ReadPermission)(forward(invocationPath)))
	router.Method(http.MethodDelete, t.InvocationPath, guard(t.InvokePermission)(forward(invocationPath)))
	return router, nil
}

func invocationPath(r *http.Request) string {
	return spi.InvocationPath(
		chi.URLParam(r, "toolkit_name"),
		chi.URLParam(r, "tool_name"),
		chi.URLParam(r, "invocation_id"))
}
