// Package scim serves SCIM 2.0 user provisioning (RFC 7643, RFC 7644).
//
// # What this is for
//
// An identity provider that federates logins can also PUSH the directory:
// create the account when somebody joins, update it when their name or address
// changes, and deactivate it when they leave. Without it an account is created
// on first login and never removed, so a person who left the company keeps a
// working account until somebody suspends it by hand.
//
// Nothing here is a port. `grep -ril scim legacy/plugins/` finds nothing: pylon
// never had SCIM either.
//
// # The base URL an operator configures
//
//	https://<host>/api/v2/scim/v2
//
// Not `/scim/v2`. Every authenticated route in this service lives under
// `/api/v2`, and that prefix is where the authentication middleware is mounted
// (internal/api/router.go). A second, separately-authenticated tree at the root
// would be a second place for the identity check to be got wrong.
//
// # How a client authenticates, and why there is no SCIM token type
//
// With a PERSONAL ACCESS TOKEN, as a bearer credential, belonging to an account
// that holds `admin.auth.users` in administration mode — the same permission the
// admin Users page's write routes require. A SCIM client that can create and
// deactivate accounts is doing exactly what that page does.
//
// The alternative was a dedicated SCIM token table with its own hashing,
// rotation and admin surface. It was rejected: a PAT is already a static bearer
// credential with an owner, an expiry and a revocation path, and a second
// credential type would be a second set of those to get right. What an operator
// does instead is create a service account, grant it the administration role,
// and mint a token — all of which the platform already supports.
//
// # Users only, and Groups says so rather than pretending
//
// `/Groups` is NOT implemented, and `ServiceProviderConfig` and `ResourceTypes`
// both say so rather than advertising a resource that answers nothing. The
// reason is that this platform has no group a SCIM Group could BE. Its
// authorisation is roles resolved per project, plus a central administration
// mode; a SCIM Group carries a flat name and a member list with no project in
// it, so any mapping would have to invent the missing half — and the wrong
// invention silently grants people access to projects.
//
// Advertising `/Groups` and answering an empty list would be worse than
// refusing: an identity provider would report every group push as succeeding.

package scim

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/scimdirectory"
)

// BasePath is where this tree is mounted, and the value that appears in every
// `meta.location`. It is declared once so the router and the resource encoder
// cannot disagree about it.
const BasePath = "/api/v2/scim/v2"

// MountPath is the same tree relative to the `/api/v2` group the router mounts
// it inside.
//
// The two are separate constants because they answer different questions and
// are used in different places: chi needs the relative path, and `meta.location`
// must be the absolute one a client can fetch. Deriving one from the other with
// a TrimPrefix would tie the router's nesting to the wire contract, so a change
// to the nesting would silently rewrite every location a client has stored.
const MountPath = "/scim/v2"

const (
	schemaUser         = "urn:ietf:params:scim:schemas:core:2.0:User"
	schemaListResponse = "urn:ietf:params:scim:api:messages:2.0:ListResponse"
	schemaError        = "urn:ietf:params:scim:api:messages:2.0:Error"
	schemaProviderCfg  = "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"
	schemaResourceType = "urn:ietf:params:scim:schemas:core:2.0:ResourceType"

	// contentType is the media type RFC 7644 defines. `application/json` is
	// also accepted on the way in, because several identity providers send it.
	contentType = "application/scim+json"

	// defaultPageSize and maxPageSize bound a listing. A client that asks for
	// no count gets the default; one that asks for more than the maximum gets
	// the maximum, which is what RFC 7644 §3.4.2.4 says a service provider may
	// do — and it is why `itemsPerPage` is returned rather than assumed.
	defaultPageSize = 100
	maxPageSize     = 500
)

// Directory is the store seam. An interface so this package can be tested
// without a database, and so the HTTP shape and the SQL stay separable.
type Directory interface {
	List(ctx context.Context, filter scimdirectory.Filter, startIndex, count int) ([]scimdirectory.User, int, error)
	Get(ctx context.Context, id int) (scimdirectory.User, error)
	Create(ctx context.Context, user scimdirectory.User) (scimdirectory.User, error)
	Replace(ctx context.Context, id int, user scimdirectory.User) (scimdirectory.User, error)
	SetActive(ctx context.Context, id int, active bool) (scimdirectory.User, error)
}

// Handler serves the SCIM tree.
type Handler struct {
	directory Directory
}

func NewHandler(directory Directory) *Handler {
	return &Handler{directory: directory}
}

// Routes returns the SCIM sub-router.
//
// It is assembled HERE rather than in internal/api/router.go so the paths and
// their handlers stay in one file — the tree is a published contract an operator
// pastes into an identity provider, and a path spread across two files is a path
// that gets renamed in one of them.
func (h *Handler) Routes() chi.Router {
	router := chi.NewRouter()
	router.Get("/ServiceProviderConfig", h.ServiceProviderConfig)
	router.Get("/ResourceTypes", h.ResourceTypes)
	router.Get("/Schemas", h.Schemas)

	router.Get("/Users", h.ListUsers)
	router.Post("/Users", h.CreateUser)
	router.Get("/Users/{id}", h.GetUser)
	router.Put("/Users/{id}", h.ReplaceUser)
	router.Patch("/Users/{id}", h.PatchUser)
	router.Delete("/Users/{id}", h.DeleteUser)

	// /Groups is declared unsupported rather than left to 404. A 404 reads as
	// "wrong URL" and sends an operator to check their base path; this says
	// what is actually true. See the package comment for why there is no group
	// to map onto.
	//
	// Registered per METHOD rather than with HandleFunc, which would bind all
	// nine of chi's verbs — including CONNECT and TRACE — and put eighteen
	// entries into the router's published surface for a resource that does
	// nothing. These five are what a SCIM client sends.
	for _, method := range []string{
		http.MethodGet, http.MethodPost, http.MethodPut,
		http.MethodPatch, http.MethodDelete,
	} {
		router.Method(method, "/Groups", http.HandlerFunc(h.groupsUnsupported))
		router.Method(method, "/Groups/*", http.HandlerFunc(h.groupsUnsupported))
	}
	return router
}

func (h *Handler) groupsUnsupported(w http.ResponseWriter, _ *http.Request) {
	writeError(w, http.StatusNotImplemented, "",
		"group provisioning is not implemented: this platform authorises through per-project roles, "+
			"which a SCIM group cannot express, so a group push would be accepted and enforce nothing. "+
			"Provision users here and assign their roles in the admin panel.")
}

// ready reports whether the directory is wired, answering 503 when it is not.
//
// A SCIM client treats a 5xx as retryable and a 2xx as done. Answering an empty
// list from an unwired handler would tell an identity provider that this
// deployment has no users and that every deactivation had already been applied.
func (h *Handler) ready(w http.ResponseWriter) bool {
	if h.directory != nil {
		return true
	}
	writeError(w, http.StatusServiceUnavailable, "",
		"user provisioning is not available on this deployment")
	return false
}

/* ── discovery ─────────────────────────────────────────────────────────── */

// ServiceProviderConfig answers `GET /ServiceProviderConfig`.
//
// Every capability below is reported as it IS. `patch.supported` is true and
// `bulk.supported` is false because that is what this handler does; a
// configuration document that over-reports is how a client comes to send
// requests the server then fails.
func (h *Handler) ServiceProviderConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"schemas": []string{schemaProviderCfg},
		"documentationUri": "https://" +
			"github.com/EliteaAI/elitea-platform/blob/main/services/elitea-main/internal/api/scim/scim.go",
		"patch":          map[string]any{"supported": true},
		"bulk":           map[string]any{"supported": false, "maxOperations": 0, "maxPayloadSize": 0},
		"filter":         map[string]any{"supported": true, "maxResults": maxPageSize},
		"changePassword": map[string]any{"supported": false},
		"sort":           map[string]any{"supported": false},
		"etag":           map[string]any{"supported": false},
		"authenticationSchemes": []map[string]any{{
			"type":        "oauthbearertoken",
			"name":        "OAuth Bearer Token",
			"description": "A platform personal access token belonging to an account that holds admin.auth.users.",
			"primary":     true,
		}},
		"meta": map[string]any{
			"resourceType": "ServiceProviderConfig",
			"location":     BasePath + "/ServiceProviderConfig",
		},
	})
}

// ResourceTypes answers `GET /ResourceTypes`. It lists User and NOT Group; see
// the package comment.
func (h *Handler) ResourceTypes(w http.ResponseWriter, _ *http.Request) {
	userType := map[string]any{
		"schemas":     []string{schemaResourceType},
		"id":          "User",
		"name":        "User",
		"endpoint":    "/Users",
		"description": "Platform accounts.",
		"schema":      schemaUser,
		"meta": map[string]any{
			"resourceType": "ResourceType",
			"location":     BasePath + "/ResourceTypes/User",
		},
	}
	writeJSON(w, http.StatusOK, listResponse([]any{userType}, 1, 1))
}

// Schemas answers `GET /Schemas` with the attributes this directory really
// reads.
//
// It describes FIVE attributes and no more. A client uses this document to
// decide what to send, so listing the whole core User schema would invite it to
// push a manager, a department and a set of phone numbers that this service
// stores nowhere.
func (h *Handler) Schemas(w http.ResponseWriter, _ *http.Request) {
	attribute := func(name, kind, description string) map[string]any {
		return map[string]any{
			"name": name, "type": kind, "multiValued": false,
			"description": description, "required": name == "userName",
			"caseExact": false, "mutability": "readWrite",
			"returned": "default", "uniqueness": uniquenessOf(name),
		}
	}
	userSchema := map[string]any{
		"id":          schemaUser,
		"name":        "User",
		"description": "Platform account.",
		"attributes": []map[string]any{
			attribute("userName", "string", "The account's email address. Case-insensitive."),
			attribute("displayName", "string", "The name shown in the product."),
			attribute("active", "boolean", "False suspends the account; it is not deleted."),
			attribute("externalId", "string", "The identity provider's own identifier."),
			attribute("emails", "complex", "The primary value is kept as the account address."),
		},
		"meta": map[string]any{"resourceType": "Schema", "location": BasePath + "/Schemas/" + schemaUser},
	}
	writeJSON(w, http.StatusOK, listResponse([]any{userSchema}, 1, 1))
}

func uniquenessOf(name string) string {
	if name == "userName" || name == "externalId" {
		return "server"
	}
	return "none"
}

/* ── encoding ──────────────────────────────────────────────────────────── */

func listResponse(resources []any, total, perPage int) map[string]any {
	return map[string]any{
		"schemas":      []string{schemaListResponse},
		"totalResults": total,
		"startIndex":   1,
		"itemsPerPage": perPage,
		// Capital R. RFC 7644 §3.4.2 names the member `Resources`, and a client
		// that looks for `resources` finds nothing — which reads to it as an
		// empty directory rather than as a malformed response.
		"Resources": resources,
	}
}

// userResource renders one account.
//
// `id` is a STRING. SCIM ids are strings by definition, and a client that
// received a JSON number would send it back quoted on the next request — or,
// worse, round-trip it through a float.
func userResource(user scimdirectory.User) map[string]any {
	resource := map[string]any{
		"schemas":     []string{schemaUser},
		"id":          strconv.Itoa(user.ID),
		"userName":    user.UserName,
		"displayName": user.DisplayName,
		"name":        map[string]any{"formatted": user.DisplayName},
		"active":      user.Active,
		"emails": []map[string]any{{
			"value": user.UserName, "primary": true, "type": "work",
		}},
		"meta": map[string]any{
			"resourceType": "User",
			"created":      user.CreatedAt.UTC().Format(time.RFC3339),
			"lastModified": user.UpdatedAt.UTC().Format(time.RFC3339),
			"location":     BasePath + "/Users/" + strconv.Itoa(user.ID),
		},
	}
	// OMITTED when empty rather than sent as "". A client that reads back an
	// empty externalId may take it as an instruction to clear its own mapping.
	if user.ExternalID != "" {
		resource["externalId"] = user.ExternalID
	}
	return resource
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// writeError renders the SCIM error shape.
//
// `scimType` is the machine-readable code from RFC 7644 §3.12 —
// `invalidFilter`, `uniqueness`, `invalidValue`, `mutability`. Identity
// providers switch on it, and an error that carries only prose makes a
// duplicate-address refusal indistinguishable from a malformed request.
func writeError(w http.ResponseWriter, status int, scimType, detail string) {
	body := map[string]any{
		"schemas": []string{schemaError},
		"status":  strconv.Itoa(status),
		"detail":  detail,
	}
	if scimType != "" {
		body["scimType"] = scimType
	}
	writeJSON(w, status, body)
}
