package account

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

// EgressNotAllowedReason is the rejection reason emitted when a provider
// credential's api_base names a host the operator's egress allowlist does not
// cover (issue #13).
const EgressNotAllowedReason = "EGRESS_HOST_NOT_ALLOWED"

// ErrEgressNotAllowed is returned when a credential is rejected by the egress
// allowlist. It carries EgressNotAllowedReason so callers can map it to an HTTP
// 400 invalid_request_error (spec §2.5) without disclosing the host.
var ErrEgressNotAllowed = errors.New(EgressNotAllowedReason)

// egressAllowlist is the operator-configured set of hosts a tenant-authored
// api_base may name.
//
// # Why a host allowlist and not an IP-range check
//
// The gateway's problem is that `api_base` comes from the tenant: any user who
// can author a credential row picks the address the gateway dials
// (`buildKey` threads it into the Ollama / Azure / vLLM key configs). An
// IP-range check performed here would be a check-then-dial race — the name we
// resolve is not necessarily the address bifrost's transport later connects to,
// which is the classic DNS-rebinding bypass. A *name* allowlist has no such
// race: the operator asserts "this hostname is a legitimate destination", and
// whatever it resolves to at dial time is by definition operator-sanctioned.
//
// The complementary half of the policy lives in GetConfigForProvider: private
// network destinations are refused by bifrost's own SSRF-safe dialer (which
// checks the address it is about to dial, so it has no race either) UNLESS an
// allowlist is configured. The two together give:
//
//	no allowlist   → public destinations only, any host        (safe default)
//	allowlist set  → allowlisted hosts only, private permitted (opt-in)
//
// There is deliberately no third mode in which a tenant reaches an arbitrary
// private address.
type egressAllowlist struct {
	// exact matches "host" or "host:port", lowercased.
	exact map[string]struct{}
	// suffix holds "*.example.com" entries as ".example.com" (with the port,
	// when the entry pinned one, in portOf). A candidate matches when its host
	// ends with the suffix AND has at least one extra label in front.
	suffix []suffixRule
}

type suffixRule struct {
	// dotted is the suffix including the leading dot, e.g. ".example.com".
	dotted string
	// port is "" when the entry pinned no port, else the required port.
	port string
}

// newEgressAllowlist parses the operator's GATEWAY_EGRESS_ALLOWLIST entries.
// Entries are `host`, `host:port`, `*.domain` or `*.domain:port`. An entry that
// cannot be parsed is an error rather than a silent skip: a typo that silently
// dropped one rule would either open the gateway wider than intended or wedge a
// legitimate provider, and both are worse than refusing to start.
func newEgressAllowlist(entries []string) (*egressAllowlist, error) {
	a := &egressAllowlist{exact: make(map[string]struct{}, len(entries))}
	for _, raw := range entries {
		e := strings.ToLower(strings.TrimSpace(raw))
		if e == "" {
			continue
		}
		if strings.ContainsAny(e, "/ \t") || strings.Contains(e, "://") {
			return nil, fmt.Errorf("egress allowlist entry %q: want host or host:port (no scheme, path or spaces)", raw)
		}
		host, port := e, ""
		if h, p, err := net.SplitHostPort(e); err == nil {
			host, port = h, p
		}
		if strings.HasPrefix(host, "*.") {
			dotted := host[1:] // "*.example.com" -> ".example.com"
			if dotted == "." || strings.Contains(dotted[1:], "*") {
				return nil, fmt.Errorf("egress allowlist entry %q: wildcard must be a single leading \"*.\" label", raw)
			}
			a.suffix = append(a.suffix, suffixRule{dotted: dotted, port: port})
			continue
		}
		if host == "" || strings.Contains(host, "*") {
			return nil, fmt.Errorf("egress allowlist entry %q: wildcards are only allowed as a leading \"*.\"", raw)
		}
		a.exact[e] = struct{}{}
	}
	return a, nil
}

// configured reports whether the operator supplied any entry. When false the
// allowlist imposes no host restriction (and private-network dialing stays off).
func (a *egressAllowlist) configured() bool {
	return a != nil && (len(a.exact) > 0 || len(a.suffix) > 0)
}

// allows reports whether apiBase may be dialled.
//
// An EMPTY apiBase is allowed: the credential then carries no endpoint at all
// and bifrost uses the provider's own default (api.openai.com etc.), which is
// not tenant-controlled and so is not what this allowlist governs.
//
// A non-empty apiBase that cannot be parsed into a host is REFUSED. Failing
// closed here matters: an unparsable value is exactly what an attacker probing
// for a parser differential between this check and the transport would submit.
func (a *egressAllowlist) allows(apiBase string) bool {
	if strings.TrimSpace(apiBase) == "" {
		return true
	}
	if !a.configured() {
		return true
	}

	u, err := url.Parse(strings.TrimSpace(apiBase))
	if err != nil || u.Host == "" {
		return false
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "" {
		return false
	}
	port := u.Port()
	if port == "" {
		// Compare against the scheme's default so a "host:443" rule still
		// matches "https://host" and vice versa.
		switch strings.ToLower(u.Scheme) {
		case "https":
			port = "443"
		case "http":
			port = "80"
		}
	}

	if _, ok := a.exact[host]; ok {
		return true
	}
	if port != "" {
		if _, ok := a.exact[net.JoinHostPort(host, port)]; ok {
			return true
		}
	}
	for _, r := range a.suffix {
		// "at least one extra label in front": ".example.com" must not match
		// the bare "example.com", only "a.example.com" and deeper.
		if !strings.HasSuffix(host, r.dotted) || len(host) <= len(r.dotted) {
			continue
		}
		if r.port == "" || r.port == port {
			return true
		}
	}
	return false
}
