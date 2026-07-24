package admin

func configSections() []map[string]any {
	return []map[string]any{
		guardrailsSection(),
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
		maintenanceSection(),
		advancedSection(),
	}
}

func guardrailsSection() map[string]any {
	return map[string]any{
		"id":          "guardrails",
		"title":       "Guardrails",
		"description": "Control platform-wide security policies, toolkit restrictions, and MCP exposure settings.",
		"order":       1,
		"icon":        "security",
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
			{
				"key":              "mcp_enabled",
				"type":             "boolean",
				"title":            "Enable MCP",
				"description":      "Master switch for MCP (Model Context Protocol). When disabled, removes all MCP-related functionality across the entire application including API endpoints and all UI entry points.",
				"path":             "mcp_exposure.enabled",
				"section":          "guardrails",
				"default":          true,
				"requires_restart": true,
			},
			{
				"key":              "mcp_in_menu",
				"type":             "boolean",
				"title":            "Show MCPs in UI",
				"description":      "When disabled, hides all MCP entry points across the UI while keeping MCP API functionality intact.",
				"path":             "mcp_exposure.in_menu",
				"section":          "guardrails",
				"default":          true,
				"requires_restart": true,
				"visible_when":     map[string]any{"field": "mcp_enabled", "value": true},
			},
			{
				"key":              "is_publish_blocked",
				"type":             "boolean",
				"title":            "Block Agent Publishing",
				"description":      "When enabled, agent publishing is blocked platform-wide except for whitelisted projects. Admin publishes from the public project are always exempt.",
				"path":             "publishing_guardrail.is_publish_blocked",
				"section":          "guardrails",
				"default":          false,
				"requires_restart": true,
			},
			{
				"key":              "publish_whitelist_project_ids",
				"type":             "array",
				"items":            map[string]any{"type": "integer"},
				"title":            "Publishing Allowed Projects",
				"description":      "Projects where publishing remains allowed when blocked globally. If empty, publishing is blocked for all projects.",
				"path":             "publishing_guardrail.whitelist_project_ids",
				"section":          "guardrails",
				"default":          []any{},
				"requires_restart": true,
				"enum_source":      "projects",
				"visible_when":     map[string]any{"field": "is_publish_blocked", "value": true},
			},
			{
				"key":              "publish_validation_rules",
				"type":             "string",
				"format":           "textarea",
				"title":            "Publish Validation Rules",
				"description":      "Custom evaluation criteria for AI validation of agents before publishing. Leave empty to use built-in rules.",
				"path":             "publishing_guardrail.publish_validation_rules",
				"section":          "guardrails",
				"default":          "",
				"requires_restart": true,
			},
			{
				"key":         "agent_categories",
				"type":        "array",
				"items":       map[string]any{"type": "string"},
				"title":       "Agent Categories",
				"description": "Additional agent categories available in the publish modal and Agent Studio filter bar. Built-in defaults cannot be removed here. New categories take effect immediately without a restart.",
				"path":        "publishing_guardrail.agent_categories",
				"section":     "guardrails",
				"default":     []any{},
			},
		},
	}
}

func mcpServersSection() map[string]any {
	return map[string]any{
		"id":          "mcp_servers",
		"title":       "MCP Servers",
		"description": "Configure Model Context Protocol server definitions available to the indexer runtime.",
		"order":       2,
		"icon":        "dns",
		"fields": []map[string]any{
			{
				"key":              "mcp_servers",
				"type":             "object",
				"title":            "MCP Server Definitions",
				"description":      "Pre-configured MCP servers that appear as selectable toolkits. Supports stdio (local subprocess) and http (remote) server types.",
				"path":             "mcp_servers",
				"section":          "mcp_servers",
				"default":          map[string]any{},
				"requires_restart": true,
			},
		},
	}
}

func observabilitySection() map[string]any {
	return map[string]any{
		"id":          "observability",
		"title":       "Observability",
		"description": "Manage distributed tracing and audit trail settings across all pylons.",
		"order":       3,
		"icon":        "monitoring",
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
		"id":          "litellm",
		"title":       "LiteLLM",
		"description": "Configure the LiteLLM proxy — connection mode, credentials, and model access policies.",
		"order":       4,
		"icon":        "model_training",
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
// gateway.governance_config table; the gateway GovernanceStore reads them at load
// and enforces them. Budget limits are USD numbers (§5.1) — the gateway scales
// them to nano-USD for counter comparison.
func governanceSection() map[string]any {
	return map[string]any{
		"id":                  "governance",
		"title":               "LLM Governance",
		"description":         "Author LLM-gateway governance: budgets, rate limits, credential billing policy, per-model/provider scopes, MCP allowlists, and CEL routing rules. Definitions are read by the gateway for enforcement.",
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
		"id":          "runtime",
		"title":       "Runtime",
		"description": "Configure indexer worker runtime behavior, task processing, and development settings.",
		"order":       5,
		"icon":        "settings",
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
		"id":          "admin_panel",
		"title":       "Admin Panel",
		"description": "Manage admin panel plugin availability and reload capabilities.",
		"order":       6,
		"icon":        "admin_panel_settings",
		"fields":      []map[string]any{},
	}
}

func authSection() map[string]any {
	return map[string]any{
		"id":          "auth",
		"title":       "Authentication",
		"description": "Configure the authentication provider and identity settings.",
		"order":       7,
		"icon":        "lock",
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
		"id":             "resources",
		"title":          "Resources",
		"description":    "Configure resource cards displayed on the environment-wide Resources page.",
		"order":          88,
		"icon":           "menu_book",
		"always_visible": true,
		"fields":         result,
	}
}

func dedicatedBannerSection() map[string]any {
	return map[string]any{
		"id":             "dedicated_banner",
		"title":          "Banner",
		"description":    "Enable dedicated banner to communicate important notifications across the platform.",
		"order":          89,
		"icon":           "campaign",
		"always_visible": true,
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
		"id":             "support_assistant",
		"title":          "Support Assistant",
		"description":    "Enable the in-app support assistant widget for all users.",
		"order":          89,
		"icon":           "support_agent",
		"always_visible": true,
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
		"id":             "voice_features",
		"title":          "Voice Features",
		"description":    "Control Voice-to-Voice, Text-to-Voice, and Voice-to-Text features environment-wide.",
		"order":          90,
		"icon":           "record_voice_over",
		"always_visible": true,
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
		"id":             "maintenance",
		"title":          "Maintenance",
		"description":    "Enable maintenance mode to show a splash screen to all non-admin users.",
		"order":          91,
		"icon":           "construction",
		"always_visible": true,
		"fields":         []map[string]any{},
	}
}

func advancedSection() map[string]any {
	return map[string]any{
		"id":                  "advanced",
		"title":               "Advanced",
		"description":         "View and edit raw plugin configurations for all connected pylons.",
		"order":               100,
		"icon":                "code",
		"always_visible":      true,
		"required_permission": "configuration.advanced",
		"fields":              []map[string]any{},
	}
}
