package configurations

// selfref.go — circular-routing guard #1 at UPSERT time (spec §2.6):
// reject any credential configuration whose api_base resolves to the
// platform's own /llm origin, with reason SELF_REFERENTIAL_CREDENTIAL.
// This replicates the legacy tools/mappers/integration/open_ai.py guard and
// runs on every credential create AND update — the gateway's Account-side
// check (services/elitea-llm-gateway/internal/account) is the request-time
// backstop; this is the authoring-time front door.
//
// The normalisation + matching rules mirror the gateway's account package
// exactly (normaliseOrigin / isSegmentPrefixOf) so a credential rejected at
// use time is also rejected at save time and vice versa.

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"sync"
)

// SelfReferentialCredentialReason matches the gateway's rejection reason so
// callers and the UI see one vocabulary for this failure.
const SelfReferentialCredentialReason = "SELF_REFERENTIAL_CREDENTIAL"

// selfOriginsEnv lists the platform's own /llm origins, comma-separated
// (e.g. "https://dev.elitea.ai/llm/v1,http://elitea-main:8080/llm/v1").
// DEPLOYMENT_URL, when set, is additionally treated as a self origin with
// "/llm" appended, so the common single-domain deployment is guarded with
// zero extra configuration.
const selfOriginsEnv = "ELITEA_SELF_LLM_ORIGINS"

var (
	selfOriginsOnce   sync.Once
	selfOriginsCached []string
)

// selfLLMOrigins resolves the configured self origins once per process.
func selfLLMOrigins() []string {
	selfOriginsOnce.Do(func() {
		selfOriginsCached = buildSelfOrigins(os.Getenv(selfOriginsEnv), os.Getenv("DEPLOYMENT_URL"))
	})
	return selfOriginsCached
}

// buildSelfOrigins is the pure assembly of the self-origin list (testable).
func buildSelfOrigins(originsCSV, deploymentURL string) []string {
	var out []string
	for _, o := range strings.Split(originsCSV, ",") {
		if n := normaliseOrigin(o); n != "" {
			out = append(out, n)
		}
	}
	if deploymentURL != "" {
		if n := normaliseOrigin(strings.TrimRight(deploymentURL, "/") + "/llm"); n != "" {
			out = append(out, n)
		}
	}
	return out
}

// validateNotSelfReferential rejects a credential data map whose api_base
// points at one of the platform's own /llm origins. A data map without an
// api_base (or with an unparsable one) passes — emptiness/parsability is the
// concern of per-type validation, not this guard.
func validateNotSelfReferential(data map[string]any, selfOrigins []string) error {
	apiBase, _ := data["api_base"].(string)
	if apiBase == "" || len(selfOrigins) == 0 {
		return nil
	}
	if isSelfReferential(apiBase, selfOrigins) {
		return fmt.Errorf("%s: api_base %q points at the platform's own /llm origin — a credential must target an upstream provider, not the gateway itself (spec §2.6)",
			SelfReferentialCredentialReason, apiBase)
	}
	return nil
}

// isSelfReferential mirrors the gateway account package's matching:
// segment-aware, case-insensitive comparison on normalised origins, in both
// prefix directions.
func isSelfReferential(apiBase string, selfOrigins []string) bool {
	n := normaliseOrigin(apiBase)
	if n == "" {
		return false
	}
	nLower := strings.ToLower(n)
	for _, self := range selfOrigins {
		selfLower := strings.ToLower(self)
		if nLower == selfLower ||
			isSegmentPrefixOf(nLower, selfLower) || isSegmentPrefixOf(selfLower, nLower) {
			return true
		}
	}
	return false
}

// isSegmentPrefixOf reports whether prefix is a path-segment prefix of s
// (followed by "/" or equal), preventing "/llm/v" from matching "/llm/v1".
func isSegmentPrefixOf(prefix, s string) bool {
	if !strings.HasPrefix(s, prefix) {
		return false
	}
	rest := s[len(prefix):]
	return rest == "" || rest[0] == '/'
}

// normaliseOrigin canonicalises a URL to scheme://host[:port]/path with the
// trailing slash removed, lowercased scheme/host, trailing FQDN dot stripped,
// and default ports dropped — byte-for-byte the gateway's rules.
func normaliseOrigin(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	scheme := strings.ToLower(u.Scheme)

	hostname := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	portStr := u.Port()
	isDefaultPort := (scheme == "https" && portStr == "443") ||
		(scheme == "http" && portStr == "80")
	var host string
	if portStr == "" || isDefaultPort {
		host = hostname
	} else {
		host = net.JoinHostPort(hostname, portStr)
	}

	path := strings.TrimRight(u.Path, "/")
	return scheme + "://" + host + path
}
