package api

import forwardapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/forwardauth"

// CurrentMainRoutePublicRules is the source-evidenced compatibility catalog
// registered dynamically by the currently deployed Main plugins. The four
// operator-configured auth.yml rules remain in the versioned Form config.
//
// Evidence: testdata/baseline/main-auth-http-contracts.json
// public_rule_inventory.main_local_plane.dynamic_registration_sites.
// Each future Go route owner should take over its entry when that route moves.
func CurrentMainRoutePublicRules() []forwardapp.PublicRule {
	return []forwardapp.PublicRule{
		uriRule("current.artifacts.s3", `^/artifacts/s3/.*$`),
		uriRule("current.admin_ui.assets", `^/admin/app/.*\.(js|css|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|map)$`),
		uriRule("current.elitea_core.socket_io", `^/socket\.io/.*$`),
		uriRule("current.elitea_core.robots", `^/robots\.txt$`),
		uriRule("current.elitea_core.favicon", `^/favicon\.ico$`),
		uriRule("current.elitea_core.access_denied", `^/app/access_denied$`),
		uriRule("current.elitea_core.webhook", `^/api/v2/elitea_core/webhook/prompt_lib/[0-9]+/[0-9]+/(github|gitlab|custom)$`),
		uriRule("current.elitea_core.public_messages", `^/elitea_core/[0-9]+/messages\?session_id=.+$`),
		uriRule("current.runtime_interface_litellm", `^/llm/.*$`),
	}
}

func uriRule(name, pattern string) forwardapp.PublicRule {
	return forwardapp.PublicRule{
		Name: name,
		Conditions: []forwardapp.RuleCondition{{
			Field:   forwardapp.SourceURI,
			Pattern: pattern,
		}},
	}
}
