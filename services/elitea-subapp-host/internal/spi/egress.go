package spi

import (
	"net/url"
	"strings"
)

// EgressPolicy is the git-host allowlist: which hosts a runner may clone
// from, read from the application's GIT_ALLOWLIST. Fail-closed — an empty
// policy refuses every destination — with "*" as the explicit opt-out.
//
// Byte-identical matching rules to the Python shell's and to
// elitea-main's api/v2/deepwiki/egress.go: "*.x" matches direct subdomains
// only, ports are stripped, IPv6 literals unwrapped. Three spellings of one
// rule is exactly the duplication ADR-0023 retires; this one replaces the
// Python one.
type EgressPolicy struct {
	Entries []string
}

// ParseEgressPolicy reads a comma- or space-separated allowlist.
func ParseEgressPolicy(raw string) EgressPolicy {
	var entries []string
	for _, part := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ' ' || r == '\t' || r == '\n' }) {
		if part = strings.ToLower(strings.TrimSpace(part)); part != "" {
			entries = append(entries, part)
		}
	}
	return EgressPolicy{Entries: entries}
}

// AllowsEverything reports the explicit "*" opt-out.
func (p EgressPolicy) AllowsEverything() bool {
	for _, entry := range p.Entries {
		if entry == "*" {
			return true
		}
	}
	return false
}

// IsEmpty reports a policy with no entries — which refuses everything.
func (p EgressPolicy) IsEmpty() bool { return len(p.Entries) == 0 }

// Permits reports whether host is on the list.
func (p EgressPolicy) Permits(host string) bool {
	if p.AllowsEverything() {
		return true
	}
	candidate := strings.ToLower(strings.TrimSpace(host))
	if candidate == "" {
		return false
	}
	if strings.HasPrefix(candidate, "[") {
		candidate = strings.SplitN(candidate[1:], "]", 2)[0]
	} else if strings.Count(candidate, ":") == 1 {
		candidate = strings.SplitN(candidate, ":", 2)[0]
	}
	for _, entry := range p.Entries {
		if strings.HasPrefix(entry, "*.") {
			suffix := entry[1:]
			if strings.HasSuffix(candidate, suffix) && !strings.Contains(strings.TrimSuffix(candidate, suffix), ".") {
				return true
			}
		} else if candidate == entry {
			return true
		}
	}
	return false
}

// Check refuses a destination the policy does not permit, with the legacy
// message (an invalid_input, so the caller reads it as their request).
func (p EgressPolicy) Check(host, what string) error {
	if p.IsEmpty() {
		return Failf(KindValue, "No git-host allowlist is configured, so the %s %q is refused. Set the "+
			"GIT_ALLOWLIST variable to the hosts this deployment may clone from (or '*' to disable the control explicitly).", what, host)
	}
	if !p.Permits(host) {
		return Failf(KindValue, "The %s %q is not on the git-host allowlist (%s), so this invocation is refused before any credential is used.",
			what, host, strings.Join(p.Entries, ", "))
	}
	return nil
}

// Describe is the /health projection of the policy.
func (p EgressPolicy) Describe() map[string]any {
	entries := p.Entries
	if entries == nil {
		entries = []string{}
	}
	return map[string]any{"configured": !p.IsEmpty(), "unrestricted": p.AllowsEverything(), "entries": entries}
}

// HostOf extracts the host of a URL, an scp-like git address, or a bare host.
func HostOf(value string) string {
	candidate := strings.TrimSpace(value)
	if candidate == "" {
		return ""
	}
	if strings.Contains(candidate, "://") {
		if parsed, err := url.Parse(candidate); err == nil {
			return strings.ToLower(parsed.Hostname())
		}
		return ""
	}
	if strings.HasPrefix(candidate, "git@") && strings.Contains(candidate, ":") {
		return strings.ToLower(strings.SplitN(candidate[4:], ":", 2)[0])
	}
	if parsed, err := url.Parse("//" + candidate); err == nil && parsed.Hostname() != "" {
		return strings.ToLower(parsed.Hostname())
	}
	return strings.ToLower(candidate)
}
