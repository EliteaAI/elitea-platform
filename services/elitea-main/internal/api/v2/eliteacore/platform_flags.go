package eliteacore

// The READ side of the admin Features page — unit A14, issue #200.
//
// The Features page writes `centry.platform_config`; this file is where those
// rows are consulted. It is a separate file because "what actually reads this
// flag" is the question the whole unit turns on, and the answer should be one
// grep, not an archaeology exercise. Every helper here is called from a handler
// in `handler.go`, and every field the page offers as available is read by one
// of them:
//
//	mcp_enabled                    → mcpFlags, gating PlatformSettings AND the
//	                                 three MCP proxy/sync routes
//	mcp_in_menu                    → mcpFlags, marshalled as mcp_in_menu_enabled
//	is_publish_blocked             → publishGuardrail, enforced in Publish
//	publish_whitelist_project_ids  → publishGuardrail, ditto
//	agent_categories               → extraAgentCategories, merged into
//	                                 AgentCategories
//	vite_voice_features_enabled    → voiceFlags, marshalled as
//	                                 voice_features_enabled and read by
//	                                 widgets/chat's VoiceButton
//	vite_voice_features_temporarily_disabled
//	                               → voiceFlags, ditto
//
// A flag with no entry in that list does not belong on the available side of the
// page. `config_schemas.go` states the same fact from the other end, as an
// `unavailable_reason`; if the two ever disagree, the schema is what the
// operator is shown and this file is what the platform does, so the schema is
// the one that is wrong.
//
// ## Why every failure here is permissive
//
// These reads are on the request path of ordinary product traffic — listing
// agent categories, loading the shell's feature flags. A store that cannot be
// read is an operational fault, and resolving it to "MCP is disabled" or
// "publishing is blocked" would turn a database hiccup into a platform-wide
// outage of a subsystem nobody switched off. The one place that is NOT true is
// the admin page's own read (`config_values.go`), which reports the failure,
// because an operator editing configuration must never be shown defaults as if
// they were the stored state.

import (
	"context"
	"net/http"
	"strconv"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/platformconfig"
)

// parseProjectID turns the URL segment into the integer the whitelist stores.
//
// A segment that is not an integer yields -1, which no whitelist entry can
// match, so a malformed project id is refused while the guardrail is on rather
// than falling through to project 0. The alternative — treating an unparseable
// id as "not blocked" — would make the guardrail bypassable by sending a project
// id the router accepts and `strconv` does not.
func parseProjectID(raw string) int64 {
	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return -1
	}
	return parsed
}

// mcpFlagState is the resolved MCP switch pair.
type mcpFlagState struct {
	// enabled is the master switch. False means the MCP API endpoints refuse.
	enabled bool
	// inMenu hides the UI entry points while leaving the API working. It is
	// meaningless while enabled is false and is reported as false there, so a
	// client cannot render an MCP menu entry for a subsystem whose endpoints
	// would 403.
	inMenu bool
}

func (h *Handler) mcpFlags(ctx context.Context) mcpFlagState {
	values, err := platformconfig.Load(ctx, h.pool, platformconfig.SectionMCPConfiguration)
	if err != nil {
		return mcpFlagState{enabled: true, inMenu: true}
	}
	enabled := values.Bool(platformconfig.KeyMCPEnabled, true)
	return mcpFlagState{
		enabled: enabled,
		inMenu:  enabled && values.Bool(platformconfig.KeyMCPInMenu, true),
	}
}

// requireMCPEnabled is the gate on the MCP HTTP surface.
//
// It returns true when the request may proceed. The 403 and its wording match
// pylon's (`legacy/plugins/elitea_core/api/v2/mcp_dcr_proxy.py:54`), because the
// existing clients of these routes were written against that answer.
//
// This is the half of the master switch that cannot be done in the client. The
// field's own description promises the switch "removes all MCP-related
// functionality across the entire application including API endpoints"; a
// version that only hid the buttons would leave every one of these routes open
// to anyone who kept a URL, while telling the operator they had closed them.
func (h *Handler) requireMCPEnabled(w http.ResponseWriter, r *http.Request) bool {
	if h.mcpFlags(r.Context()).enabled {
		return true
	}
	writeJSON(w, http.StatusForbidden, map[string]any{
		"error": "MCP exposure is disabled on this deployment",
	})
	return false
}

// voiceFlagState is the resolved Voice Features pair.
type voiceFlagState struct {
	// enabled hides every voice control when false.
	enabled bool
	// temporarilyDisabled leaves them VISIBLE but non-interactive, with the
	// admin tooltip the button already renders. It is reported as false while
	// `enabled` is false for the same reason `inMenu` is: "visible but
	// disabled" is not a state a hidden control can be in, and a client that
	// combined the two itself would be inventing the rule.
	temporarilyDisabled bool
}

func (h *Handler) voiceFlags(ctx context.Context) voiceFlagState {
	values, err := platformconfig.Load(ctx, h.pool, platformconfig.SectionVoiceFeatures)
	if err != nil {
		return voiceFlagState{enabled: true}
	}
	enabled := values.Bool(platformconfig.KeyVoiceEnabled, true)
	return voiceFlagState{
		enabled:             enabled,
		temporarilyDisabled: enabled && values.Bool(platformconfig.KeyVoiceTemporarilyDisabled, false),
	}
}

// publishGuardrailState is the resolved agent-publishing guardrail.
type publishGuardrailState struct {
	blocked   bool
	whitelist []int64
}

// allows answers whether a given project may publish.
//
// An empty whitelist while blocked means nobody may publish — that is what the
// field's description says and what the reference's own text says
// ("If empty, publishing is blocked for all projects"). The tempting reading,
// that an empty list means "no restrictions", would invert the control at
// exactly the moment an operator first switches it on and has not yet added an
// exemption.
func (g publishGuardrailState) allows(projectID int64) bool {
	if !g.blocked {
		return true
	}
	for _, allowed := range g.whitelist {
		if allowed == projectID {
			return true
		}
	}
	return false
}

func (h *Handler) publishGuardrail(ctx context.Context) publishGuardrailState {
	values, err := platformconfig.Load(ctx, h.pool, platformconfig.SectionAgentPublishing)
	if err != nil {
		return publishGuardrailState{}
	}
	return publishGuardrailState{
		blocked:   values.Bool(platformconfig.KeyPublishBlocked, false),
		whitelist: values.Ints(platformconfig.KeyPublishWhitelistProjectIDs),
	}
}

// extraAgentCategories returns the operator-configured categories.
func (h *Handler) extraAgentCategories(ctx context.Context) []string {
	values, err := platformconfig.Load(ctx, h.pool, platformconfig.SectionAgentPublishing)
	if err != nil {
		return nil
	}
	return values.Strings(platformconfig.KeyAgentCategories)
}
