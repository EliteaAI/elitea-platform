package admin

// Why most of these sections carry an `unavailable_reason` — unit A14, #200.
//
// This file describes what the admin Configuration page can offer. In pylon
// those descriptions are assembled at request time from every plugin's
// `admin_schema.json` as announced over the Arbiter bus, and each field's `path`
// addresses a key inside that plugin's YAML config; saving one re-serialises the
// YAML and ships it back to the pylon that owns it
// (legacy/plugins/admin/api/v2/plugin_config_values.py — see the header of
// config_values.go for the whole chain).
//
// None of that exists here, and AGENTS.md says it is not meant to: "Do not
// preserve Pylon plugin loading … as target architecture." A field whose only
// consumer is a Pylon plugin descriptor therefore has nowhere to go, and the
// honest answer is to say so ON THE SECTION rather than to render a form.
//
// `unavailable_reason` is declared HERE, on the server, for the same reason the
// permission is: it is a fact about the deployment, and a page that decided it
// locally would drift from what the endpoints actually do. `config_values.go`
// answers 501 with this exact string, and the ported page renders it.
//
// Removing a reason is how a section becomes live — and it is only correct to
// remove one once something in this platform READS the values. `resources` is
// the section that passes that test: apps/elitea-web's Help Center reads it back
// through `GET /admin/plugin_config_values/prompt_lib/resources`.
import "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/eliteacore"

const (
	// pylonPluginConfigUnavailable covers every section whose fields address a
	// key inside a Pylon plugin's YAML config and are read by that plugin at
	// load time — guardrails, MCP server definitions, tracing switches, the
	// indexer worker's runtime flags, the auth provider.
	pylonPluginConfigUnavailable = "these settings configure Pylon plugin runtimes: the reference page collects them " +
		"from plugin heartbeats and saves them by shipping patched plugin YAML back over the Arbiter bus. This " +
		"platform has no plugin descriptors to reconfigure and nothing here reads these values, so editing them " +
		"would have no effect. Use the Pylon admin panel while the hybrid deployment is running."

	// extraUIConfigUnavailable covers the `extra_ui_config.*` sections other
	// than `resources`. These are not Pylon RUNTIME concerns — they are product
	// settings that legacy delivered by injecting the whole of elitea_core's
	// `extra_ui_config` into `window.elitea_ui_config`. They are unavailable for
	// the narrower reason that no surface in this platform reads them yet, which
	// is a gap to close rather than a boundary to respect.
	extraUIConfigUnavailable = "nothing in this platform reads this setting yet. The legacy UI received it by " +
		"injecting the plugin's extra_ui_config into the page; no equivalent consumer has been built here, so the " +
		"control is withheld rather than shown saving into a void."

	// maintenanceSplashUnavailable — pylon's maintenance mode is a gevent router
	// hook installed on the bootstrap plugin's persisted state, serving a 503
	// splash to anyone whose administration-mode roles do not include admin
	// (legacy/plugins/bootstrap/tools/splash.py). Nothing in this service
	// installs such a hook, and inventing one would be a new product feature.
	maintenanceSplashUnavailable = "maintenance mode is a Pylon request hook that serves a 503 splash to non-admin " +
		"users; this platform installs no such hook, so the switch would toggle a setting nothing enforces."

	// advancedRuntimeUnavailable — the Advanced section is raw plugin YAML
	// editing, per-pylon log tailing and plugin update/reload. All four of its
	// endpoints are Pylon runtime introspection.
	advancedRuntimeUnavailable = "the Advanced section edits raw plugin YAML, tails pylon logs and reloads plugins " +
		"on live Pylon runtimes. Those runtimes are not part of this platform."

	// governanceElsewhereUnavailable — the LLM-governance fields are NOT saved
	// through this endpoint even in the reference: elitea-main has its own CRUD
	// at `/admin/gateway/governance` writing `gateway.governance_config`. That
	// surface is real, but nothing reads it — see internal/api/gateway/governance.go
	// and the note in the PR: the gateway's GovernanceStore never queries the
	// table, despite two artefacts claiming that it does. #466 corrected the
	// second claim, in governanceSection() below. The first claim is still in
	// the header of migrations/shared/0067_gateway_budget_schema.sql; that file
	// is checksum-immutable once applied (internal/infra/db/migrate/manifest.go),
	// so a later migration, not an edit, must carry the correction. #218 owns it.
	governanceElsewhereUnavailable = "LLM governance is authored through /admin/gateway/governance, not through this " +
		"page. It is withheld here because the gateway does not yet read gateway.governance_config, so definitions " +
		"saved through either surface are not enforced."

	// serviceDescriptorsElsewhereUnavailable — the section is unavailable for
	// the SAME reason its own page is, and says so in the same words.
	//
	// Until that page was ported this said only "service descriptors are a page
	// of their own in the admin port (issue #200)", which deferred to a surface
	// that did not exist yet. Deferring to one that now exists and itself says
	// "unavailable" would be worse: an operator following the pointer would be
	// told something different at the other end. The constant lives with the
	// endpoints that enforce it.
	serviceDescriptorsElsewhereUnavailable = eliteacore.ServiceDescriptorsUnavailableReason

	// skillPublishingUnavailable — the reference's Skill Publishing section
	// governs a publishing pipeline this service does not have. `grep -rn
	// skill_publishing_guardrail services/` returns nothing; there is no skill
	// publish handler, no skill categories endpoint and no skill catalog filter
	// bar to feed. Declaring the four fields so the form could render them would
	// be inventing settings for a subsystem that is not here.
	skillPublishingUnavailable = "skill publishing is not implemented in this service: there is no skill publish " +
		"endpoint, no skill catalog and no skill categories surface for these settings to govern. The controls are " +
		"withheld rather than shown governing nothing."

	// supportAssistantWidgetUnavailable replaces the generic extra_ui_config
	// reason with the specific one. The switch would be read by
	// `GET /support_assistant/config`, whose only client is
	// `widgets/support-assistant/ui/SupportAssistantWidget.tsx` — and that
	// widget is not mounted anywhere (`grep -rn SupportAssistantWidget src/`
	// finds one doc-comment mention and no JSX site), renders no floating
	// assistant, and documents in its own body that `@eliteaai/elitea-assistant`
	// is not a dependency of this app. Turning the switch on would change one
	// boolean in an unmounted component.
	supportAssistantWidgetUnavailable = "the in-app support assistant is not mounted in this application: the " +
		"@eliteaai/elitea-assistant package is not a dependency and SupportAssistantWidget has no render site, so " +
		"enabling it would change a flag no rendered surface reads."

	// publishValidationRulesUnavailable is a FIELD-level reason, not a section
	// one. The rest of `agent_publishing` is enforced for real; this one field
	// alone has nothing behind it. `runPublishValidation` in
	// internal/api/v2/eliteacore/handler.go is entirely deterministic — version
	// name collisions, generic names, sub-agent cycles and depth — with no model
	// call anywhere in it, so a custom evaluation prompt has no evaluator to
	// reach. A section-level reason would have withheld three working controls
	// to disclose one broken one.
	publishValidationRulesUnavailable = "publish validation in this service is deterministic (name collisions, " +
		"sub-agent cycles and depth); there is no AI evaluator for custom criteria to reach, so these rules would " +
		"never be applied."
)

// Which page a section belongs to.
//
// The reference decides this IN THE CLIENT: `FeaturesPage.jsx` hardcodes a list
// of six sections and `ConfigurationPage.jsx` hardcodes the complementary
// `MOVED_TO_FEATURES` array plus three config-path prefixes to subtract from
// Guardrails. Two client-side lists that must stay each other's complement is a
// drift waiting to happen, and it is the same mistake #217 removed when it moved
// `service_descriptors` out of the client's section list and onto the server.
//
// So placement is declared here, next to the fields, and both pages filter on
// it. A section with no `page` belongs to Configuration — the default keeps the
// eight sections that were already there exactly where they were.
const (
	configPageFeatures = "features"
)

func configSections() []map[string]any {
	return []map[string]any{
		guardrailsSection(),
		mcpConfigurationSection(),
		agentPublishingSection(),
		skillPublishingSection(),
		mcpServersSection(),
		observabilitySection(),
		litellmSection(),
		governanceSection(),
		runtimeSection(),
		adminPanelSection(),
		authSection(),
		resourcesSection(),
		dedicatedBannerSection(),
		supportAssistantSection(),
		voiceFeaturesSection(),
		serviceDescriptorsSection(),
		maintenanceSection(),
		advancedSection(),
	}
}

// serviceDescriptorsSection is declared HERE rather than appended by the page.
//
// The reference client injects `{id: "service_descriptors", title: …}` into the
// section list itself, so the sidebar shows an entry the server never described.
// Every other section — including its permission and, now, its availability — is
// server-declared, and one that is not is one the page can get wrong on its own.
func serviceDescriptorsSection() map[string]any {
	return map[string]any{
		"id":                  "service_descriptors",
		"unavailable_reason":  serviceDescriptorsElsewhereUnavailable,
		"title":               "Service Descriptors",
		"description":         "Registered provider service descriptors.",
		"order":               8,
		"icon":                "settings_input_component",
		"always_visible":      true,
		"required_permission": "configuration.service_descriptors",
		"fields":              []map[string]any{},
	}
}

func guardrailsSection() map[string]any {
	return map[string]any{
		"id":                 "guardrails",
		"unavailable_reason": pylonPluginConfigUnavailable,
		"title":              "Guardrails",
		"description":        "Control platform-wide security policies, toolkit restrictions, and MCP exposure settings.",
		"order":              1,
		"icon":               "security",
		"fields": []map[string]any{
			{
				"key":         "blocked_toolkits",
				"type":        "array",
				"items":       map[string]any{"type": "string"},
				"title":       "Blocked Toolkits",
				"description": "Toolkit types that are completely disabled platform-wide. Blocked toolkits will not be registered, listed, or creatable.",
				"path":        "toolkit_security.blocked_toolkits",
				"section":     "guardrails",
				"default":     []any{},
				"enum_source": "toolkit_names",
			},
			{
				"key":                  "blocked_tools",
				"type":                 "object",
				"additionalProperties": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"title":                "Blocked Tools",
				"description":          "Specific tools blocked within allowed toolkits. Map of toolkit type to list of blocked tool names.",
				"path":                 "toolkit_security.blocked_tools",
				"section":              "guardrails",
				"default":              map[string]any{},
				"enum_source_keys":     "toolkit_names",
				"enum_source_values":   "toolkit_tools",
			},
			{
				"key":                  "sensitive_tools",
				"type":                 "object",
				"additionalProperties": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"title":                "Sensitive Action Tools",
				"description":          "Tools that require explicit user authorization before execution. Map of toolkit type to list of tool names that trigger an authorization dialog at runtime.",
				"path":                 "toolkit_security.sensitive_tools",
				"section":              "guardrails",
				"default":              map[string]any{},
				"enum_source_keys":     "toolkit_names",
				"enum_source_values":   "toolkit_tools",
			},
			{
				"key":         "sensitive_action_company_name",
				"type":        "string",
				"title":       "Company Name for Policy Message",
				"description": "Company name displayed in the sensitive action authorization dialog. Used in the policy message template.",
				"path":        "toolkit_security.sensitive_action_company_name",
				"section":     "guardrails",
				"default":     "",
			},
			{
				"key":         "sensitive_action_message_template",
				"type":        "string",
				"title":       "Authorization Message Template",
				"description": "Message template shown in the authorization dialog. Supports placeholders: {company_name}, {action_name}, {tool_name}, {toolkit_name}.",
				"path":        "toolkit_security.sensitive_action_message_template",
				"section":     "guardrails",
				"default":     "",
			},
			// `mcp_exposure.*` and `publishing_guardrail.*` used to be declared
			// here. They are the fields the reference relocates onto the Features
			// page by config-path prefix, and they are the only fields in this
			// section this platform actually reads — so they now live in
			// `mcpConfigurationSection()` and `agentPublishingSection()`, which
			// carry no `unavailable_reason`. Leaving copies here would have been
			// two declarations of one setting, and the unavailable one would have
			// told the operator the opposite of the truth.
		},
	}
}

// mcpConfigurationSection — the Features page's MCP switches. LIVE.
//
// This is the master switch pylon exposes as `mcp_exposure.enabled`, read into
// module state at plugin load and consulted by every MCP surface it has
// (legacy/plugins/elitea_core/utils/mcp_config.py, and its callers in
// mcp_dcr_proxy, mcp_oauth_proxy, mcp_sync_tools and routes/mcp_sse).
//
// It is available here because this platform now reads it in both of the places
// that matter:
//
//   - `GET /elitea_core/platform_settings/prompt_lib` marshals `mcp_enabled` and
//     `mcp_in_menu_enabled` from these rows, and apps/elitea-web's four
//     `useIsMcpVisible` hooks and its `/mcps` route gate on them;
//   - the three MCP proxy routes (`mcp_oauth_proxy`, `mcp_dcr_proxy`,
//     `mcp_sync_tools`) refuse with 403 when the master switch is off, which is
//     what "removes all MCP-related functionality … including API endpoints"
//     has to mean. A switch that only hides the buttons is not a kill switch,
//     and an operator who read that description and turned it off would believe
//     they had closed the API.
func mcpConfigurationSection() map[string]any {
	return map[string]any{
		"id":          "mcp_configuration",
		"page":        configPageFeatures,
		"title":       "MCP Configuration",
		"description": "Control Model Context Protocol exposure across the platform.",
		"order":       10,
		"icon":        "extension",
		"fields": []map[string]any{
			{
				"key":         "mcp_enabled",
				"type":        "boolean",
				"title":       "Enable MCP",
				"description": "Master switch for MCP (Model Context Protocol). When disabled, the MCP proxy and tool-sync endpoints refuse with 403 and every MCP entry point is hidden.",
				"path":        "mcp_exposure.enabled",
				"section":     "mcp_configuration",
				"default":     true,
				// No `requires_restart`. The reference marks both fields as
				// needing one because a pylon reads them into module state at
				// plugin load; here every consumer reads the row per request, so
				// the change is live on the next call. Carrying the flag over
				// would have asked the operator to press a reload button that
				// answers 501.
			},
			{
				"key":         "mcp_in_menu",
				"type":        "boolean",
				"title":       "Show MCPs in UI",
				"description": "When disabled, hides MCP entry points in the UI while leaving the MCP API endpoints working.",
				"path":        "mcp_exposure.in_menu",
				"section":     "mcp_configuration",
				"default":     true,
				// Rendered only while the master switch is on: "hide the menu
				// entry" is not a meaningful choice once the whole subsystem is
				// off, and showing it would imply the two combine in some way
				// they do not.
				"visible_when": map[string]any{"field": "mcp_enabled", "value": true},
			},
		},
	}
}

// agentPublishingSection — the Features page's publishing guardrail. LIVE,
// except for one field that says why it is not.
//
// `is_publish_blocked` and `publish_whitelist_project_ids` are enforced in
// `POST /elitea_core/publish/prompt_lib/{projectID}/{versionID}` — before this
// unit that handler validated the version name, the agent type and the publish
// status and never once asked whether publishing was blocked, so the switch the
// reference page offers had no effect on the only publish path this service has.
//
// `agent_categories` is merged into `GET /elitea_core/agent_categories/…`, which
// apps/elitea-web's `useAgentHubData` reads for the Agents Hub filter bar.
func agentPublishingSection() map[string]any {
	return map[string]any{
		"id":          "agent_publishing",
		"page":        configPageFeatures,
		"title":       "Agent Publishing",
		"description": "Control who may publish agents, and which categories they may publish into.",
		"order":       11,
		"icon":        "publish",
		"fields": []map[string]any{
			{
				"key":         "is_publish_blocked",
				"type":        "boolean",
				"title":       "Block Agent Publishing",
				"description": "When enabled, agent publishing is refused platform-wide except from the projects listed below.",
				"path":        "publishing_guardrail.is_publish_blocked",
				"section":     "agent_publishing",
				"default":     false,
			},
			{
				"key":         "publish_whitelist_project_ids",
				"type":        "array",
				"items":       map[string]any{"type": "integer"},
				"title":       "Publishing Allowed Projects",
				"description": "Projects where publishing remains allowed while it is blocked globally. If empty, publishing is blocked everywhere.",
				"path":        "publishing_guardrail.whitelist_project_ids",
				"section":     "agent_publishing",
				"default":     []any{},
				"visible_when": map[string]any{
					"field": "is_publish_blocked", "value": true,
				},
			},
			{
				"key":         "agent_categories",
				"type":        "array",
				"items":       map[string]any{"type": "string"},
				"title":       "Agent Categories",
				"description": "Additional agent categories offered alongside the built-in defaults. The built-in defaults cannot be removed here.",
				"path":        "publishing_guardrail.agent_categories",
				"section":     "agent_publishing",
				"default":     []any{},
			},
			{
				"unavailable_reason": publishValidationRulesUnavailable,
				"key":                "publish_validation_rules",
				"type":               "string",
				"format":             "textarea",
				"title":              "Publish Validation Rules",
				"description":        "Custom evaluation criteria for AI validation of agents before publishing.",
				"path":               "publishing_guardrail.publish_validation_rules",
				"section":            "agent_publishing",
				"default":            "",
				
			},
		},
	}
}

// skillPublishingSection — declared, and declared unavailable.
//
// The alternative was to omit it. Omitting it would have made the section
// silently disappear relative to the reference, which reads to an operator as a
// page that lost a feature rather than a platform that does not have one; the
// reason is the only thing that distinguishes those two.
func skillPublishingSection() map[string]any {
	return map[string]any{
		"id":                 "skill_publishing",
		"page":               configPageFeatures,
		"unavailable_reason": skillPublishingUnavailable,
		"title":              "Skill Publishing",
		"description":        "Control who may publish skills, and which categories they may publish into.",
		"order":              12,
		"icon":               "bolt",
		"fields":             []map[string]any{},
	}
}

// mcpServersUnavailable sends this section's caller to the surface that really
// holds the catalogue.
//
// This section used to carry pylonPluginConfigUnavailable, and that WAS true of
// it: the values addressed the indexer_worker plugin descriptor, collected over
// the Arbiter bus, and nothing here read them. It is no longer the whole truth,
// because the catalogue itself now exists — shared migration 0092,
// `internal/mcpregistry` and the three routes in mcp_prebuilt.go — so a reader
// told only "Pylon plugin runtimes" would conclude the feature is missing when
// it is merely somewhere else.
//
// The section stays unavailable rather than becoming writable for one reason,
// and it is the same reason rejectCredentialField exists: a catalogue entry
// carries a client secret, and this page's fields are stored as plaintext JSONB
// rows in centry.platform_config that every holder of `runtime.plugins` can
// read. The dedicated surface seals the secret into the platform vault and
// returns a mask. Serving the same data here would mean either storing that
// credential in clear text or accepting a save that silently drops it.
const mcpServersUnavailable = "MCP server definitions are not stored as plugin configuration on this " +
	"platform: an entry carries a client secret, and the values on this page are kept as plaintext " +
	"rows readable by everyone who can open it. The catalogue lives at " +
	"/api/v2/admin/mcp_prebuilt_servers/administration, which seals each client secret into the " +
	"platform vault and never returns it. It takes effect on the next call rather than on the next " +
	"restart, so no field here carries requires_restart."

func mcpServersSection() map[string]any {
	return map[string]any{
		"id":                 "mcp_servers",
		"unavailable_reason": mcpServersUnavailable,
		"title":              "MCP Servers",
		"description":        "Configure Model Context Protocol server definitions available to the indexer runtime.",
		"order":              2,
		"icon":               "dns",
		// No fields. The one field this section declared was the whole
		// `mcp_servers` object, and declaring it here would describe a control
		// that this page cannot serve — the same "renders as a working control
		// and is not one" failure rejectUnavailableField was written for.
		"fields": []map[string]any{},
	}
}

func observabilitySection() map[string]any {
	return map[string]any{
		"id":                 "observability",
		"unavailable_reason": pylonPluginConfigUnavailable,
		"title":              "Observability",
		"description":        "Manage distributed tracing and audit trail settings across all pylons.",
		"order":              3,
		"icon":               "monitoring",
		"fields": []map[string]any{
			{
				"key":              "tracing_enabled",
				"type":             "boolean",
				"title":            "Tracing",
				"description":      "Master switch to enable or disable all distributed tracing.",
				"path":             "enabled",
				"section":          "observability",
				"default":          true,
				"requires_restart": true,
			},
			{
				"key":              "audit_trail_enabled",
				"type":             "boolean",
				"title":            "Audit Trail",
				"description":      "Enable audit trail that persists user actions and agent tool calls to the database.",
				"path":             "audit_trail.enabled",
				"section":          "observability",
				"default":          true,
				"requires_restart": true,
			},
			{
				"key":              "analytics_enabled",
				"type":             "boolean",
				"title":            "Show Analytics",
				"description":      "Controls whether the Analytics tab is visible in project Settings. When disabled, the Analytics page is hidden for all users.",
				"path":             "analytics.enabled",
				"section":          "observability",
				"default":          true,
				"requires_restart": true,
			},
		},
	}
}

func litellmSection() map[string]any {
	return map[string]any{
		"id":                 "litellm",
		"unavailable_reason": pylonPluginConfigUnavailable,
		"title":              "LiteLLM",
		"description":        "Configure the LiteLLM proxy — connection mode, credentials, and model access policies.",
		"order":              4,
		"icon":               "model_training",
		"fields": []map[string]any{
			{
				"key":              "litellm_mode",
				"type":             "string",
				"title":            "LiteLLM Mode",
				"description":      "Use the built-in Elitea LiteLLM proxy or connect to an external instance.",
				"path":             "litellm_mode",
				"section":          "litellm",
				"default":          "built-in",
				"enum":             []string{"built-in", "external"},
				"requires_restart": true,
			},
			{
				"key":              "litellm_database_mode",
				"type":             "string",
				"title":            "Database",
				"description":      "Use the shared Elitea database or a custom PostgreSQL connection string.",
				"path":             "litellm_database_mode",
				"section":          "litellm",
				"default":          "elitea",
				"enum":             []string{"elitea", "custom"},
				"requires_restart": true,
				"visible_when":     map[string]any{"field": "litellm_mode", "value": "built-in"},
			},
			{
				"key":              "litellm_db_name",
				"type":             "string",
				"title":            "LiteLLM Database Name",
				"description":      "Database name for LiteLLM on the shared PostgreSQL server. Uses POSTGRES_* env vars for host/credentials.",
				"path":             "litellm_db_name",
				"section":          "litellm",
				"default":          "litellm",
				"requires_restart": true,
				"visible_when": []map[string]any{
					{"field": "litellm_mode", "value": "built-in"},
					{"field": "litellm_database_mode", "value": "elitea"},
				},
			},
			{
				"key":              "database_url",
				"type":             "string",
				"format":           "password",
				"title":            "Custom Database URL",
				"description":      "PostgreSQL connection string. Example: postgresql://user:pass@host:5432/litellm_db",
				"path":             "database_url",
				"section":          "litellm",
				"default":          nil,
				"requires_restart": true,
				"visible_when":     map[string]any{"field": "litellm_database_mode", "value": "custom"},
			},
			{
				"key":              "external_litellm_url",
				"type":             "string",
				"title":            "External LiteLLM URL",
				"description":      "Base URL of the external LiteLLM instance (e.g., https://litellm.example.com/llm).",
				"path":             "external_litellm_url",
				"section":          "litellm",
				"default":          "",
				"requires_restart": true,
				"visible_when":     map[string]any{"field": "litellm_mode", "value": "external"},
			},
			{
				"key":              "litellm_master_key",
				"type":             "string",
				"format":           "password",
				"title":            "Master Key",
				"description":      "API key for authenticating LiteLLM proxy requests.",
				"path":             "litellm_master_key",
				"section":          "litellm",
				"default":          nil,
				"requires_restart": true,
			},
			{
				"key":              "log_request_response_data",
				"type":             "boolean",
				"title":            "Log Request/Response Data",
				"description":      "Store full prompts and completions in LiteLLM spend logs.",
				"path":             "log_request_response_data",
				"section":          "litellm",
				"default":          false,
				"requires_restart": true,
				"visible_when":     map[string]any{"field": "litellm_mode", "value": "built-in"},
			},
			{
				"key":         "allow_project_own_llms",
				"type":        "boolean",
				"title":       "Allow Projects to Bring Own LLMs",
				"description": "When disabled, only public project models are available to all projects.",
				"path":        "allow_project_own_llms",
				"section":     "litellm",
				"default":     true,
			},
			{
				"key":          "sync_llm_entities",
				"type":         "action",
				"title":        "Sync LLM Entities",
				"description":  "Reconcile all teams, keys, and models across all projects. Long-running operation.",
				"section":      "litellm",
				"action_task":  "sync_llm_entities",
				"visible_when": map[string]any{"field": "litellm_mode", "value": "built-in"},
			},
			{
				"key":         "import_llm_models",
				"type":        "action",
				"title":       "Import Models from LiteLLM",
				"description": "Discover unmanaged models in LiteLLM, create configuration records, and update team access for all projects.",
				"section":     "litellm",
				"action_task": "import_llm_models",
			},
			{
				"key":         "seed_llm_keys",
				"type":        "action",
				"title":       "Seed Project Keys",
				"description": "Create missing LiteLLM teams and API keys for all projects. Use after initial setup or if projects are missing access.",
				"section":     "litellm",
				"action_task": "seed_llm_keys",
			},
		},
	}
}

// governanceSection describes the LLM-gateway governance authoring surface
// (design-governance-config-authoring §2-3): budgets, rate limits, per-credential
// rate_policy, per-model/provider scopes, the MCP allowlist, and CEL routing
// rules. The renderer maps each field spec to a widget (§2); the routing_rules
// array is detected by SchemaField.jsx and handed to the purpose-built
// RoutingRuleEditor. required_permission hides the section client-side, but the
// authorization boundary is the server-side RequirePermissions wrapper on the
// governance CRUD routes (§4) — this attribute is convenience only.
//
// All values authored here are DEFINITIONS written to the global
// gateway.governance_config table. NOTHING READS THEM. `grep -rn
// governance_config services/elitea-llm-gateway` returns no hit, and the
// gateway's GovernanceStore is constructed with no pool, so no definition
// written through this schema or through /admin/gateway/governance reaches an
// admission check. Budget limits are USD numbers (§5.1); a gateway that begins
// to read them must scale them to nano-USD for counter comparison.
//
// This comment asserted the opposite until #466, while
// governanceElsewhereUnavailable (this file, ~line 70) denied it. The denial was
// correct. The `description` below carried the same false assertion into the
// admin-page payload, where an operator read it, authored a rule, and believed a
// limit was in force.
//
// Do not restore an enforcement claim in either place. Issue #218 owns the
// decision about whether the gateway must read this table, and the two
// statements are pinned together by TestGovernanceSchemaMakesNoEnforcementClaim
// in config_schemas_claims_internal_test.go.
func governanceSection() map[string]any {
	return map[string]any{
		"id":                  "governance",
		"unavailable_reason":  governanceElsewhereUnavailable,
		"title":               "LLM Governance",
		"description":         "Author LLM-gateway governance: budgets, rate limits, credential billing policy, per-model/provider scopes, MCP allowlists, and CEL routing rules. Definitions are stored, but the gateway does not enforce them yet.",
		"order":               5,
		"icon":                "policy",
		"required_permission": "configuration.governance",
		"fields": []map[string]any{
			// --- Budget (project/team/customer/global) ---
			{
				"key":         "budget_is_unlimited",
				"type":        "boolean",
				"title":       "Unlimited Budget",
				"description": "When enabled, no spend limit is enforced and the fields below are ignored.",
				"path":        "budget.is_unlimited",
				"section":     "governance",
				"default":     true,
			},
			{
				"key":          "budget_limit_usd",
				"type":         "number",
				"title":        "Budget Limit (USD)",
				"description":  "Hard spend limit in US dollars per period. Authored in USD; the gateway scales it to nano-USD for counter comparison.",
				"path":         "budget.limit_usd",
				"section":      "governance",
				"default":      nil,
				"minimum":      0,
				"visible_when": map[string]any{"field": "budget_is_unlimited", "value": false},
			},
			{
				"key":          "budget_period",
				"type":         "string",
				"title":        "Budget Period",
				"description":  "The window over which the budget limit accumulates before resetting.",
				"path":         "budget.period",
				"section":      "governance",
				"default":      "monthly",
				"enum":         []string{"daily", "weekly", "monthly", "yearly"},
				"visible_when": map[string]any{"field": "budget_is_unlimited", "value": false},
			},
			{
				"key":          "budget_soft_alert_pct",
				"type":         "integer",
				"title":        "Soft Alert Threshold (%)",
				"description":  "Budget-utilisation percentage (1-100) at which a soft alert is emitted before the hard limit is reached.",
				"path":         "budget.soft_alert_pct",
				"section":      "governance",
				"default":      80,
				"minimum":      1,
				"maximum":      100,
				"visible_when": map[string]any{"field": "budget_is_unlimited", "value": false},
			},
			{
				"key":         "budget_nats_fail_mode",
				"type":        "string",
				"title":       "Budget Fail Mode",
				"description": "How the gateway behaves when the NATS budget counter is unavailable. tiered_hybrid degrades gracefully; fail_open allows traffic; fail_closed blocks it.",
				"path":        "budget.nats_fail_mode",
				"section":     "governance",
				"default":     "tiered_hybrid",
				"enum":        []string{"tiered_hybrid", "fail_open", "fail_closed"},
			},
			// --- Rate limits (token + request buckets) ---
			{
				"key":         "rate_limit_tokens_per_min",
				"type":        "integer",
				"title":       "Token Rate Limit (per minute)",
				"description": "Maximum tokens allowed per minute. Leave empty for no token rate limit.",
				"path":        "rate_limit.tokens_per_min",
				"section":     "governance",
				"default":     nil,
				"minimum":     0,
			},
			{
				"key":         "rate_limit_requests_per_min",
				"type":        "integer",
				"title":       "Request Rate Limit (per minute)",
				"description": "Maximum requests allowed per minute. Leave empty for no request rate limit.",
				"path":        "rate_limit.requests_per_min",
				"section":     "governance",
				"default":     nil,
				"minimum":     0,
			},
			// --- Per-credential billing policy ---
			{
				"key":         "rate_policy",
				"type":        "string",
				"title":       "Credential Rate Policy",
				"description": "Billing treatment for a credential's usage. billed: normal cost accounting. zero-rate-metered: usage recorded at zero cost. excluded: usage recorded as excluded, budget counters untouched.",
				"path":        "credential.rate_policy",
				"section":     "governance",
				"default":     "billed",
				"enum":        []string{"billed", "zero-rate-metered", "excluded"},
			},
			// --- Per-model / per-provider scope ---
			{
				"key":         "scope_providers",
				"type":        "array",
				"items":       map[string]any{"type": "string"},
				"title":       "Scoped Providers",
				"description": "Providers this governance entry applies to. Empty means all providers.",
				"path":        "scope.providers",
				"section":     "governance",
				"default":     []any{},
				"enum_source": "gateway_providers",
			},
			{
				"key":         "scope_models",
				"type":        "array",
				"items":       map[string]any{"type": "string"},
				"title":       "Scoped Models",
				"description": "Models this governance entry applies to. Empty means all models.",
				"path":        "scope.models",
				"section":     "governance",
				"default":     []any{},
				"enum_source": "gateway_models",
			},
			{
				"key":         "scope_project_ids",
				"type":        "array",
				"items":       map[string]any{"type": "integer"},
				"title":       "Scoped Projects",
				"description": "Projects this governance entry applies to. Empty means all projects.",
				"path":        "scope.project_ids",
				"section":     "governance",
				"default":     []any{},
				"enum_source": "projects",
			},
			{
				"key":         "scope_team_ids",
				"type":        "array",
				"items":       map[string]any{"type": "integer"},
				"title":       "Scoped Teams",
				"description": "Teams this governance entry applies to. Empty means all teams.",
				"path":        "scope.team_ids",
				"section":     "governance",
				"default":     []any{},
				"enum_source": "gateway_teams",
			},
			// --- MCP allowlist ---
			{
				"key":         "mcp_allowlist",
				"type":        "array",
				"items":       map[string]any{"type": "string"},
				"title":       "MCP Server Allowlist",
				"description": "MCP server ids permitted through the gateway. Empty disables the allowlist (all servers permitted).",
				"path":        "mcp.allowlist",
				"section":     "governance",
				"default":     []any{},
			},
			// --- CEL routing rules (routed to RoutingRuleEditor by SchemaField) ---
			{
				"key":         "routing_rules",
				"type":        "array",
				"format":      "routing_rules",
				"title":       "CEL Routing Rules",
				"description": "Weighted routing rules. Each rule is a CEL predicate plus a weighted provider/model target list whose weights sum to 1.0. The server compiles the CEL and re-verifies the weight sum on save.",
				"path":        "routing.rules",
				"section":     "governance",
				"default":     []any{},
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"cel":      map[string]any{"type": "string"},
						"scope":    map[string]any{"type": "string"},
						"priority": map[string]any{"type": "integer"},
						"targets": map[string]any{
							"type": "array",
							"items": map[string]any{
								"type": "object",
								"properties": map[string]any{
									"provider": map[string]any{"type": "string"},
									"model":    map[string]any{"type": "string"},
									"weight":   map[string]any{"type": "number"},
								},
							},
						},
					},
				},
			},
			{
				"key":         "validate_cel",
				"type":        "action",
				"title":       "Validate CEL",
				"description": "Compile the routing-rule CEL expression against the gateway's governance environment without saving.",
				"section":     "governance",
				"action_task": "validate_cel",
			},
		},
	}
}

func runtimeSection() map[string]any {
	return map[string]any{
		"id":                 "runtime",
		"unavailable_reason": pylonPluginConfigUnavailable,
		"title":              "Runtime",
		"description":        "Configure indexer worker runtime behavior, task processing, and development settings.",
		"order":              5,
		"icon":               "settings",
		"fields": []map[string]any{
			{
				"key":              "ai_project_id",
				"type":             "integer",
				"title":            "Public Project ID",
				"description":      "Database ID of the public (Agent Studio) project. Set during initial platform setup.",
				"path":             "ai_project_id",
				"section":          "runtime",
				"default":          1,
				"requires_restart": true,
			},
			{
				"key":         "ai_project_allowed_domains",
				"type":        "string",
				"title":       "Allowed Email Domains",
				"description": "Comma-separated email domains auto-added to the public project on first login. Use * for all domains.",
				"path":        "ai_project_allowed_domains",
				"section":     "runtime",
				"default":     "centry.user",
			},
			{
				"key":         "pipeline_scheduling_enabled",
				"type":        "boolean",
				"title":       "Pipeline Scheduling Enabled",
				"description": "Master switch for the per-tick check that triggers scheduled pipeline runs.",
				"path":        "scheduler.pipeline_scheduling.enabled",
				"section":     "runtime",
				"default":     true,
			},
			{
				"key":          "pipeline_scheduling_cron",
				"type":         "string",
				"title":        "Pipeline Scheduling Cron",
				"description":  "How often the pipeline scheduling tick fires. Standard 5-field cron expression.",
				"path":         "scheduler.pipeline_scheduling.cron",
				"section":      "runtime",
				"default":      "* * * * *",
				"visible_when": map[string]any{"field": "pipeline_scheduling_enabled", "value": true},
			},
			{
				"key":         "index_scheduling_enabled",
				"type":        "boolean",
				"title":       "Index Scheduling Enabled",
				"description": "Master switch for the per-tick check that triggers scheduled toolkit index re-builds.",
				"path":        "scheduler.index_scheduling.enabled",
				"section":     "runtime",
				"default":     true,
			},
			{
				"key":          "index_scheduling_cron",
				"type":         "string",
				"title":        "Index Scheduling Cron",
				"description":  "How often the index scheduling tick fires. Standard 5-field cron expression.",
				"path":         "scheduler.index_scheduling.cron",
				"section":      "runtime",
				"default":      "* * * * *",
				"visible_when": map[string]any{"field": "index_scheduling_enabled", "value": true},
			},
			{
				"key":         "reload_enabled",
				"type":        "boolean",
				"title":       "Plugin Hot Reload",
				"description": "Allows reloading individual plugins on the fly without a full service restart. Useful during development or when applying plugin updates. Keep disabled in production.",
				"path":        "reload_enabled",
				"section":     "runtime",
				"default":     false,
			},
			{
				"key":         "task_queue_debug",
				"type":        "boolean",
				"title":       "Task Queue Debug",
				"description": "Turns on verbose logging for background task processing.",
				"path":        "task_queue_debug",
				"section":     "runtime",
				"default":     false,
			},
			{
				"key":              "indexer_tasks_enabled",
				"type":             "boolean",
				"title":            "Indexer Tasks",
				"description":      "Controls whether this worker processes background jobs such as datasource indexing, embedding generation, and scheduled tasks.",
				"path":             "indexer_tasks_enabled",
				"section":          "runtime",
				"default":          true,
				"requires_restart": true,
			},
			{
				"key":         "sdk_dev_reload",
				"type":        "boolean",
				"title":       "SDK Hot Reload",
				"description": "When enabled, the SDK is reloaded from disk on every agent run instead of using cached modules.",
				"path":        "sdk_dev_reload",
				"section":     "runtime",
				"default":     false,
			},
		},
	}
}

func adminPanelSection() map[string]any {
	return map[string]any{
		"id":                 "admin_panel",
		"unavailable_reason": pylonPluginConfigUnavailable,
		"title":              "Admin Panel",
		"description":        "Manage admin panel plugin availability and reload capabilities.",
		"order":              6,
		"icon":               "admin_panel_settings",
		"fields":             []map[string]any{},
	}
}

func authSection() map[string]any {
	return map[string]any{
		"id":                 "auth",
		"unavailable_reason": pylonPluginConfigUnavailable,
		"title":              "Authentication",
		"description":        "Configure the authentication provider and identity settings.",
		"order":              7,
		"icon":               "lock",
		"fields": []map[string]any{
			{
				"key":              "auth_provider",
				"type":             "string",
				"title":            "Authentication Provider",
				"description":      "The authentication method used for user login.",
				"path":             "auth_provider",
				"section":          "auth",
				"default":          "form",
				"enum":             []string{"form", "oidc"},
				"requires_restart": true,
			},
			{
				"key":              "form_users",
				"type":             "array",
				"title":            "Form Users",
				"description":      "Users who can log in with the form-based authentication provider. Each user needs a login name, email address, and password.",
				"path":             "users",
				"section":          "auth",
				"default":          []any{},
				"requires_restart": true,
				"visible_when":     map[string]any{"field": "auth_provider", "value": "form"},
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"login":    map[string]any{"type": "string"},
						"password": map[string]any{"type": "string"},
						"email":    map[string]any{"type": "string"},
					},
				},
			},
			{
				"key":              "oidc_metadata_endpoint",
				"type":             "string",
				"title":            "OIDC Metadata Endpoint",
				"description":      "The OpenID Connect discovery endpoint URL (e.g. https://idp.example.com/.well-known/openid-configuration).",
				"path":             "metadata_endpoint",
				"section":          "auth",
				"default":          "",
				"requires_restart": true,
				"visible_when":     map[string]any{"field": "auth_provider", "value": "oidc"},
			},
			{
				"key":              "oidc_client_id",
				"type":             "string",
				"title":            "OIDC Client ID",
				"description":      "The client identifier registered with the identity provider.",
				"path":             "client_id",
				"section":          "auth",
				"default":          "",
				"requires_restart": true,
				"visible_when":     map[string]any{"field": "auth_provider", "value": "oidc"},
			},
			{
				"key":              "oidc_client_secret",
				"type":             "string",
				"format":           "password",
				"title":            "OIDC Client Secret",
				"description":      "The client secret for authenticating with the identity provider.",
				"path":             "client_secret",
				"section":          "auth",
				"default":          "",
				"requires_restart": true,
				"visible_when":     map[string]any{"field": "auth_provider", "value": "oidc"},
			},
		},
	}
}

func resourcesSection() map[string]any {
	type cardDef struct {
		id          string
		title       string
		description string
	}
	cards := []cardDef{
		{"information", "Information", "General platform information and version details"},
		{"documentation", "Documentation", "API reference, guides, and platform concepts"},
		{"release_notes", "Release Notes", "Product updates, improvements, and fixes"},
		{"video_library", "Video Library", "Product walkthroughs and recorded sessions"},
		{"tutorials", "Tutorials", "Step-by-step guides and use cases"},
		{"interactive_tours", "Interactive Tours", "Guided tours to explore key features and workflows"},
	}

	fields := make([]map[string]any, 0, len(cards)*4)
	for _, c := range cards {
		fields = append(fields, map[string]any{
			"key":         "resources_" + c.id + "_enabled",
			"type":        "boolean",
			"title":       c.title + " Card Enabled",
			"description": "Show or hide the " + c.title + " card on the Resources page.",
			"path":        "extra_ui_config.resources." + c.id + ".enabled",
			"section":     "resources",
			"default":     true,
		})
		fields = append(fields, map[string]any{
			"key":         "resources_" + c.id + "_title",
			"type":        "string",
			"title":       c.title + " Card Title",
			"description": "Display title for the " + c.title + " resource card.",
			"path":        "extra_ui_config.resources." + c.id + ".title",
			"section":     "resources",
			"default":     c.title,
		})
		fields = append(fields, map[string]any{
			"key":         "resources_" + c.id + "_description",
			"type":        "string",
			"title":       c.title + " Card Description",
			"description": "Short description displayed on the " + c.title + " resource card.",
			"path":        "extra_ui_config.resources." + c.id + ".description",
			"section":     "resources",
			"default":     c.description,
		})
		fields = append(fields, map[string]any{
			"key":         "resources_" + c.id + "_links",
			"type":        "array",
			"title":       c.title + " Links",
			"description": "Links displayed on the " + c.title + " resource card.",
			"path":        "extra_ui_config.resources." + c.id + ".links",
			"section":     "resources",
			"default":     []any{},
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title": map[string]any{"type": "string"},
					"url":   map[string]any{"type": "string"},
				},
			},
		})
	}

	// Extra fields for the information card
	infoExtra := []map[string]any{
		{
			"key":         "resources_information_version",
			"type":        "string",
			"title":       "Information Card - ELITEA Version Value",
			"description": "Version string displayed on the Information resource card.",
			"path":        "extra_ui_config.resources.information.version",
			"section":     "resources",
			"default":     "",
		},
		{
			"key":         "resources_information_upgrade_date",
			"type":        "string",
			"title":       "Information Card - Last Upgrade Date Value",
			"description": "Last upgrade date displayed on the Information resource card.",
			"path":        "extra_ui_config.resources.information.upgrade_date",
			"section":     "resources",
			"default":     "",
		},
	}
	// Insert after the first 4 (information card fields)
	result := make([]map[string]any, 0, len(fields)+len(infoExtra))
	result = append(result, fields[:4]...)
	result = append(result, infoExtra...)
	result = append(result, fields[4:]...)

	return map[string]any{
		"id":   "resources",
		"page": configPageFeatures,
		// #217 rendered this section on the Configuration page and said in its
		// own report that it belonged here — it put it there because that is
		// where the server's schema had it, and leaving it out would have kept
		// #26 (every Help Center card reading "No links configured") open for
		// another unit. The reference is unambiguous: `ConfigurationPage.jsx`
		// subtracts `resources` via `MOVED_TO_FEATURES` and `FeaturesPage.jsx`
		// renders it as "Help Center". It moves now.
		//
		// Nothing about the Help Center's own read changes: it calls
		// `GET /admin/plugin_config_values/prompt_lib/resources`, which is a
		// separate route with no notion of which admin page authored the row.
		"title":          "Help Center",
		"description":    "Configure the resource cards shown on the environment-wide Help Center page.",
		"order":          13,
		"icon":           "menu_book",
		"always_visible": true,
		"fields":         result,
	}
}

func dedicatedBannerSection() map[string]any {
	return map[string]any{
		"id":                 "dedicated_banner",
		"unavailable_reason": extraUIConfigUnavailable,
		"title":              "Banner",
		"description":        "Enable dedicated banner to communicate important notifications across the platform.",
		"order":              89,
		"icon":               "campaign",
		"always_visible":     true,
		"fields": []map[string]any{
			{
				"key":         "banner_enabled",
				"type":        "boolean",
				"title":       "Banner Enabled",
				"description": "When enabled, a notification banner is displayed to all users environment-wide.",
				"path":        "extra_ui_config.vite_maintenance_banner.enabled",
				"section":     "dedicated_banner",
				"default":     false,
			},
			{
				"key":         "banner_dismissible",
				"type":        "boolean",
				"title":       "Dismissible",
				"description": "When enabled, users can close the banner. Dismissed state persists until a new banner is configured or the user logs out.",
				"path":        "extra_ui_config.vite_maintenance_banner.dismissible",
				"section":     "dedicated_banner",
				"default":     false,
			},
			{
				"key":         "banner_icon",
				"type":        "string",
				"title":       "Icon",
				"description": "Icon type displayed alongside the banner message.",
				"path":        "extra_ui_config.vite_maintenance_banner.icon",
				"section":     "dedicated_banner",
				"default":     "info",
				"enum":        []string{"info", "warning"},
			},
			{
				"key":         "banner_style",
				"type":        "string",
				"title":       "Banner Style",
				"description": "Visual style of the banner.",
				"path":        "extra_ui_config.vite_maintenance_banner.style",
				"section":     "dedicated_banner",
				"default":     "info",
				"enum":        []string{"info", "warning"},
			},
			{
				"key":         "banner_message",
				"type":        "string",
				"title":       "Banner Message",
				"description": "The message content displayed in the banner. Supports Markdown formatting.",
				"path":        "extra_ui_config.vite_maintenance_banner.message",
				"section":     "dedicated_banner",
				"default":     "",
			},
		},
	}
}

func supportAssistantSection() map[string]any {
	return map[string]any{
		"id":   "support_assistant",
		"page": configPageFeatures,
		// The reason is narrowed from the generic extra_ui_config one: this
		// section's switch DOES have a wire (`GET /support_assistant/config`),
		// and the wire is not what is missing. What is missing is a rendered
		// consumer at the other end. Saying "nothing reads this yet" would have
		// been true but pointed at the wrong thing to fix.
		"unavailable_reason": supportAssistantWidgetUnavailable,
		"title":              "Support Assistant",
		"description":        "Enable the in-app support assistant widget for all users.",
		"order":              14,
		"icon":               "support_agent",
		"always_visible":     true,
		"fields": []map[string]any{
			{
				"key":         "vite_elitea_assistant",
				"type":        "string",
				"title":       "Assistant Enabled",
				"description": "When enabled, the support assistant widget is available to all users environment-wide.",
				"path":        "extra_ui_config.vite_elitea_assistant",
				"section":     "support_assistant",
				"default":     "0",
			},
			{
				"key":         "support_project_id",
				"type":        "integer",
				"title":       "Support Project ID",
				"description": "Project ID used by the support assistant for conversations. Auto-created if left empty.",
				"path":        "support_project_id",
				"section":     "support_assistant",
				"default":     nil,
			},
			{
				"key":         "support_agent_project_id",
				"type":        "integer",
				"title":       "Agent Project ID",
				"description": "Project ID where the support agent is located.",
				"path":        "agent_project_id",
				"section":     "support_assistant",
				"default":     nil,
			},
			{
				"key":         "support_agent_id",
				"type":        "integer",
				"title":       "Agent ID",
				"description": "Application ID of the support agent.",
				"path":        "agent_id",
				"section":     "support_assistant",
				"default":     nil,
			},
			{
				"key":         "support_welcome_message",
				"type":        "string",
				"title":       "Welcome Message",
				"description": "Initial greeting message shown in the support widget.",
				"path":        "welcome_message",
				"section":     "support_assistant",
				"default":     "Hello! How can I help you today?",
			},
			{
				"key":         "support_assistant_name",
				"type":        "string",
				"title":       "Assistant Name",
				"description": "Display name for the support assistant.",
				"path":        "assistant_name",
				"section":     "support_assistant",
				"default":     "ELITEA Support",
			},
		},
	}
}

func voiceFeaturesSection() map[string]any {
	return map[string]any{
		"id":   "voice_features",
		"page": configPageFeatures,
		// LIVE. The first pass of this unit marked this section unavailable on
		// the strength of `VoiceControlButton`/`VoiceMiniPlayer` in
		// `features/chat-input` having no render site — which is true, and was
		// the wrong component. `widgets/chat/ui/chat-button/VoiceButton.tsx` is
		// a SECOND voice control, hardcoding the same two flags as module
		// constants, and it IS mounted: `pages/chat` → `ChatBox` →
		// `buildChatBoxInputSlots()` → `<VoiceButton>`. Both flags are now
		// marshalled by `GET /elitea_core/platform_settings/…` and read there.
		"title":              "Voice Features",
		"description":        "Control Voice-to-Voice, Text-to-Voice, and Voice-to-Text features environment-wide.",
		"order":              15,
		"icon":               "record_voice_over",
		"always_visible":     true,
		"fields": []map[string]any{
			{
				"key":         "vite_voice_features_enabled",
				"type":        "boolean",
				"title":       "Voice Features Enabled",
				"description": "When disabled, all voice features (V2V, T2V, V2T) are completely hidden for all users.",
				"path":        "extra_ui_config.vite_voice_features_enabled",
				"section":     "voice_features",
				"default":     true,
			},
			{
				"key":         "vite_voice_features_temporarily_disabled",
				"type":        "boolean",
				"title":       "Disable Voice Controls but Keep Them Visible",
				"description": "When enabled, voice buttons remain visible but are non-interactive with an admin tooltip.",
				"path":        "extra_ui_config.vite_voice_features_temporarily_disabled",
				"section":     "voice_features",
				"default":     false,
			},
		},
	}
}

func maintenanceSection() map[string]any {
	return map[string]any{
		"id":                 "maintenance",
		"unavailable_reason": maintenanceSplashUnavailable,
		"title":              "Maintenance",
		"description":        "Enable maintenance mode to show a splash screen to all non-admin users.",
		"order":              91,
		"icon":               "construction",
		"always_visible":     true,
		"fields":             []map[string]any{},
	}
}

func advancedSection() map[string]any {
	return map[string]any{
		"id":                  "advanced",
		"unavailable_reason":  advancedRuntimeUnavailable,
		"title":               "Advanced",
		"description":         "View and edit raw plugin configurations for all connected pylons.",
		"order":               100,
		"icon":                "code",
		"always_visible":      true,
		"required_permission": "configuration.advanced",
		"fields":              []map[string]any{},
	}
}
