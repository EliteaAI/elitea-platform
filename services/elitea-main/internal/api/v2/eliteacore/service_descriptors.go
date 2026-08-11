package eliteacore

// The admin SERVICE DESCRIPTORS surface — unit A14, issue #200. The tenth and
// last page of the admin port.
//
//	GET    /elitea_core/admin/administration              — the descriptor listing
//	POST   /elitea_core/register_descriptor/{projectID}   — register one
//	DELETE /elitea_core/register_descriptor/{projectID}   — remove one
//
// All three answer 501 with ServiceDescriptorsUnavailableReason. Read on for why
// that is the honest answer and not a shortcut.
//
// ## What a "service descriptor" is, in the system this page came from
//
// It is not a description of this platform's services. It is one row of pylon's
// PROVIDER HUB: an external service provider that registers itself with Elitea
// and contributes toolkits to agents.
//
//   - An `ExternalServiceProviderDescriptor` (a JSON Schema in
//     legacy/plugins/elitea_core/data/, from which a Pydantic model is generated
//     at plugin load by methods/descriptor_model.py) carries a provider `name`, a
//     `service_location_url`, a `configuration` blob and a list of
//     `provided_toolkits`, each with its tools and argument schemas.
//   - `api/v2/register_descriptor.py` validates the posted descriptor, stores the
//     raw bytes in `elitea_core_descriptor` keyed by a JSON triple of
//     (project_id, provider_name, service_location_url), and then calls
//     `init_provider`.
//   - `methods/providers.py:init_provider` performs an HTTP health check against
//     the provider's URL and files the parsed descriptor into ONE OF TWO
//     IN-PROCESS DICTS on the plugin module — `present_providers` or
//     `unhealthy_providers`.
//   - `api/v2/admin.py` — the endpoint this page reads — walks exactly those two
//     dicts and emits `{project_id, provider_name, service_location_url, healthy}`
//     per entry. `healthy` is not a stored column: it is which dict the entry
//     landed in when this pylon process last started.
//   - `methods/provider_lookup.py:lookup_provider` reads `present_providers` to
//     pick a provider for a toolkit call, and `utils/internal_tools.py` uses it to
//     decide whether image generation is available.
//
// The concept is real and it carries real data. In the reference deployment's
// database `elitea_core_descriptor` holds 22 rows — DeepWiki and Inventory
// providers across nineteen projects, plus an ImageGen provider — so this is not
// a feature nobody used.
//
// ## Why it is nonetheless not servable here
//
// 1. There is NOTHING TO READ. This service has no descriptor table, no
//    migration that would create one, no repository, and no code path that
//    registers, health-checks or looks up a provider. The single mention of the
//    subsystem in the whole Go tree is a constant asserting its absence:
//    `internal/application/configurations/current_available.go` pins the dynamic
//    source `provider_hub_configurations` to `current_source_returns_empty`.
//
// 2. There would be NOTHING TO SERVE EVEN WITH THE TABLE. Two of the four
//    columns this page displays do not come from storage. `healthy` is
//    process-local health-probe state belonging to a Pylon plugin's module
//    object, and the row set itself is the union of two such dicts — not a
//    query. Copying the table across without the runtime that fills those dicts
//    would produce a listing whose health column was invented.
//
// 3. The target architecture DOES plan provider descriptors, and deliberately
//    not these. AGENTS.md's "Go owns provider descriptors, authorization, policy,
//    routing, health, and grants" is a statement of intent about ADR-0012 and the
//    Provider Service Protocol specification, both of which are still `In Review`
//    and sit in phase P3 of the migration plan ("Convert provider descriptors to
//    immutable manifests"). That contract replaces the mutable descriptor blob
//    this page edits with an admitted, immutable `AdmittedProviderRevisionV1`
//    reached through a review pipeline, and replaces the free-form
//    `service_location_url` with a normalised reviewed origin. A page built now
//    against the pylon shape would have to be rebuilt, and in the meantime would
//    be a registration surface for a runtime that cannot invoke what it registers.
//
// So the page renders this reason and every endpoint refuses. Which is a change
// on all three routes:
//
//   - `ServiceDescriptors` answered 200 with THREE HARDCODED ROWS naming
//     `elitea_core`, `auth` and `indexer` at version "2.0.0" with status
//     "active". None of those is a provider; they are Pylon plugin names, and the
//     shape is not even this endpoint's shape — the client reads `project_id`,
//     `provider_name`, `service_location_url` and `healthy`, none of which was
//     present. It took `_ *http.Request`, so it was also ungated: any
//     authenticated session got the same answer.
//   - `RegisterDescriptor` returned `{"ok": true}` for both verbs, decoding the
//     POST body into a variable it then dropped, and was MOUNTED ON NO ROUTE at
//     all. A no-op write handler with no caller is the shape that gets wired up
//     later by someone who assumes it works.
//
// A hardcoded row that looks like real data is worse than a 501, because nobody
// investigates it. An operator reading that listing would have concluded the
// platform had three healthy services registered.
//
// ## Authorisation
//
// Gated in internal/api/router.go on the permissions the pylon originals declare,
// resolved in `administration` mode:
//
//	admin.py               -> runtime.airun.serviceproviders
//	register_descriptor.py -> provider_hub.descriptor.register
//
// The gate runs BEFORE the refusal, so an unauthorised caller gets 403 and never
// learns whether the deployment serves this at all — which sub-systems a
// deployment runs is itself information about it. `window.admin_ui_config
// .permissions` is presentation state and is never consulted here; see
// apps/elitea-web/src/pages/admin/adminUiConfig.ts.
//
// ## Mode is stated, never sniffed
//
// pylon's `api_tools.APIBase` registers `admin.py` under `mode_handlers =
// {'administration': AdminAPI}` and no other mode, so `administration` is the
// only mode this path ever had. The route is registered as a STATIC
// `administration` segment rather than `{mode}`, which means `chi.URLParam(r,
// "mode")` is `""` on exactly the requests that are administration requests —
// the trap #207's test caught. These handlers take no mode from the URL, and any
// other mode 404s rather than being answered with something plausible.

import "net/http"

// The permissions the pylon originals declare, resolved in `administration`
// mode. Constants rather than literals at the registration site because the
// router and the acceptance tests must not be able to disagree about them: a
// typo in either place alone produces a 403 that reads exactly like a
// deployment whose roles were never granted, and nothing would point at the
// spelling. `001_initial.sql` grants both to the administration-mode
// `super_admin` and `admin` roles.
const (
	// ServiceDescriptorListPermission gates the listing —
	// legacy/plugins/elitea_core/api/v2/admin.py:
	// `@auth.decorators.check_api(["runtime.airun.serviceproviders"])`.
	ServiceDescriptorListPermission = "runtime.airun.serviceproviders"

	// ServiceDescriptorRegisterPermission gates both registration verbs —
	// legacy/plugins/elitea_core/api/v2/register_descriptor.py declares
	// `provider_hub.descriptor.register` on POST and DELETE alike.
	ServiceDescriptorRegisterPermission = "provider_hub.descriptor.register"
)

// ServiceDescriptorsUnavailableReason is the single sentence the server gives for
// every refusal on this surface, and the one the admin page renders.
//
// It is exported because `internal/api/v2/admin/config_schemas.go` declares the
// same reason on the Configuration page's `service_descriptors` section. One
// string, one place: an operator who reaches the subject from either surface must
// not be told two different things, and two copies drift the moment one is
// edited.
const ServiceDescriptorsUnavailableReason = "service descriptors register EXTERNAL PROVIDERS with pylon's provider " +
	"hub: a posted descriptor is stored by elitea_core and then health-checked into an in-process dict that " +
	"lookup_provider reads when an agent calls one of that provider's toolkits. This platform has no descriptor " +
	"store, no provider health probe and no provider lookup, so there is nothing to list and nothing a " +
	"registration would reach. The replacement is specified — immutable admitted provider manifests, ADR-0012 and " +
	"the Provider Service Protocol — but both are still In Review and scheduled for migration phase P3, and that " +
	"contract deliberately does not preserve this page's mutable descriptor shape."

// ServiceDescriptors serves `GET /elitea_core/admin/administration`.
//
// It replaces a handler that answered 200 with three invented rows in a shape no
// client reads. See this file's header.
func (h *Handler) ServiceDescriptors(w http.ResponseWriter, _ *http.Request) {
	writeServiceDescriptorsRefusal(w)
}

// RegisterDescriptor serves POST and DELETE on
// `/elitea_core/register_descriptor/{projectID}`.
//
// Both verbs refuse. The handler this replaces answered `{"ok": true}` to either
// — the DELETE without looking at anything, the POST after decoding a body it
// discarded — and had no route, so nothing called it and nothing noticed. A
// registration that reports success and stores nothing is worse than a refusal:
// the operator points a provider at Elitea, sees it accepted, and finds out it
// was never reachable when an agent fails to call its tools.
func (h *Handler) RegisterDescriptor(w http.ResponseWriter, _ *http.Request) {
	writeServiceDescriptorsRefusal(w)
}

// writeServiceDescriptorsRefusal is one function so a later edit cannot make the
// verbs disagree — the read saying "unavailable" while a write quietly returns
// 200 is precisely the state this file removes.
func writeServiceDescriptorsRefusal(w http.ResponseWriter) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{
		"error": ServiceDescriptorsUnavailableReason,
	})
}
