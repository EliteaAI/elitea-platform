package account

import (
	"errors"
	"strings"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

// newEgressAccount builds an EliteaAccount with an egress allowlist configured.
func newEgressAccount(t *testing.T, db rowQuerier, vault vaultDecryptor, allowlist ...string) *EliteaAccount {
	t.Helper()
	a, err := New(Config{
		DB:                  db,
		Vault:               vault,
		ProviderConcurrency: 50,
		EgressAllowlist:     allowlist,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return a
}

// TestGetConfigForProvider_PrivateNetworkGatedOnAllowlist is the primary issue
// #13 regression guard for the SSRF carve-out. Before the fix,
// GetConfigForProvider set AllowPrivateNetwork = true UNCONDITIONALLY for the
// vLLM and Ollama classes, and the URL those classes dial is a tenant-authored
// api_base — so any user who could author a credential row could make the
// gateway open a TCP connection to any RFC-1918 address the pod can reach.
//
// The exemption is now gated on the operator having enumerated the legitimate
// destinations. With no GATEWAY_EGRESS_ALLOWLIST, bifrost's SSRF-safe dialer
// must stay armed for EVERY provider.
//
// Mutation: restore the unconditional `cfg.NetworkConfig.AllowPrivateNetwork =
// true` in GetConfigForProvider — the "no allowlist" subtests MUST fail.
func TestGetConfigForProvider_PrivateNetworkGatedOnAllowlist(t *testing.T) {
	t.Run("no allowlist: SSRF dialer stays armed for every provider", func(t *testing.T) {
		a := newTestAccount(t, &fakeDB{}, &fakeVault{})
		for _, p := range supportedProviders {
			cfg, err := a.GetConfigForProvider(p)
			if err != nil {
				t.Fatalf("GetConfigForProvider(%s): %v", p, err)
			}
			if cfg.NetworkConfig.AllowPrivateNetwork {
				t.Fatalf("provider %s: AllowPrivateNetwork = true with NO egress allowlist — "+
					"a tenant-authored api_base can steer the gateway at an internal address (issue #13)", p)
			}
		}
	})

	t.Run("allowlist configured: self-hosted classes may dial private", func(t *testing.T) {
		a := newEgressAccount(t, &fakeDB{}, &fakeVault{}, "vllm.ml.svc.cluster.local:8000")
		for _, p := range []schemas.ModelProvider{schemas.VLLM, schemas.Ollama} {
			cfg, err := a.GetConfigForProvider(p)
			if err != nil {
				t.Fatalf("GetConfigForProvider(%s): %v", p, err)
			}
			if !cfg.NetworkConfig.AllowPrivateNetwork {
				t.Fatalf("provider %s: AllowPrivateNetwork = false with an allowlist configured — "+
					"the legitimate self-hosted vLLM/Ollama use case is broken", p)
			}
		}
	})

	t.Run("allowlist configured: cloud providers keep the dialer guard", func(t *testing.T) {
		a := newEgressAccount(t, &fakeDB{}, &fakeVault{}, "vllm.ml.svc.cluster.local:8000")
		for _, p := range []schemas.ModelProvider{schemas.OpenAI, schemas.Azure, schemas.Anthropic} {
			cfg, err := a.GetConfigForProvider(p)
			if err != nil {
				t.Fatalf("GetConfigForProvider(%s): %v", p, err)
			}
			if cfg.NetworkConfig.AllowPrivateNetwork {
				t.Fatalf("provider %s: private-network dialing must never be enabled for a cloud provider class", p)
			}
		}
	})
}

// TestGetKeysForProvider_EgressAllowlistRejectsHost covers the per-credential
// half of the policy: with an allowlist configured, a credential naming a host
// that is not on it yields no key at all.
func TestGetKeysForProvider_EgressAllowlistRejectsHost(t *testing.T) {
	db := &fakeDB{rows: [][]any{
		{"cfg-evil", "", []byte(`{"api_base":"http://elitea-main.default.svc:8080","api_key":"sk"}`)},
	}}
	a := newEgressAccount(t, db, &fakeVault{}, "vllm.ml.svc.cluster.local:8000")

	_, err := a.GetKeysForProvider(ctxWithProject("1"), schemas.VLLM)
	if err == nil {
		t.Fatal("expected the egress allowlist to reject a non-allowlisted api_base host")
	}
	if !errors.Is(err, ErrEgressNotAllowed) {
		t.Fatalf("error %v does not wrap ErrEgressNotAllowed", err)
	}
	if !strings.Contains(err.Error(), EgressNotAllowedReason) {
		t.Fatalf("error %q missing reason code", err.Error())
	}
	// The rejection must not hand the caller back the host it probed.
	if strings.Contains(err.Error(), "elitea-main") {
		t.Fatalf("error %q discloses the rejected host to the caller", err.Error())
	}
}

// TestGetKeysForProvider_EgressGuardBeforeVault is the credential-exfiltration
// half of issue #13: `api_key` may be a {{secret.NAME}} reference whose
// plaintext is decrypted from the project's Fernet vault and shipped to
// whatever host api_base names, as a Bearer token. The allowlist check must
// therefore run BEFORE the vault resolve, so a destination the operator never
// sanctioned never causes a decrypt.
//
// Mutation: move the `a.egress.allows(...)` block below the `a.vault.Resolve`
// call in GetKeysForProvider — this test MUST fail (the vault error surfaces
// instead of the egress error, proving the decrypt happened first).
func TestGetKeysForProvider_EgressGuardBeforeVault(t *testing.T) {
	db := &fakeDB{rows: [][]any{
		{"cfg-exfil", "", []byte(`{"api_base":"https://attacker.example.com/v1","api_key":"{{secret.PROVIDER_KEY}}"}`)},
	}}
	vault := &fakeVault{err: errors.New("vault must not be called for a non-allowlisted destination")}
	a := newEgressAccount(t, db, vault, "vllm.ml.svc.cluster.local:8000")

	_, err := a.GetKeysForProvider(ctxWithProject("1"), schemas.VLLM)
	if !errors.Is(err, ErrEgressNotAllowed) {
		t.Fatalf("expected the egress guard to fire BEFORE the vault resolve; got %v", err)
	}
}

// TestGetKeysForProvider_EgressAllowlistAdmitsAllowedHost proves the guard is a
// filter and not a wall: the operator's own vLLM instance still works.
func TestGetKeysForProvider_EgressAllowlistAdmitsAllowedHost(t *testing.T) {
	db := &fakeDB{rows: [][]any{
		{"cfg-ok", "self-hosted", []byte(`{"api_base":"http://vllm.ml.svc.cluster.local:8000","api_key":"sk"}`)},
	}}
	a := newEgressAccount(t, db, &fakeVault{}, "vllm.ml.svc.cluster.local:8000")

	keys, err := a.GetKeysForProvider(ctxWithProject("1"), schemas.VLLM)
	if err != nil {
		t.Fatalf("allowlisted host was rejected: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("got %d keys, want 1", len(keys))
	}
	if keys[0].VLLMKeyConfig == nil {
		t.Fatal("vLLM key config missing — the credential's api_base was not threaded through")
	}
}

// TestGetKeysForProvider_NoAllowlistLeavesHostsUnrestricted pins the default
// mode. Without an allowlist the host is unrestricted (only the DIALER stops
// private destinations), so existing cloud-provider installs are unaffected.
func TestGetKeysForProvider_NoAllowlistLeavesHostsUnrestricted(t *testing.T) {
	db := &fakeDB{rows: [][]any{
		{"cfg-1", "", []byte(`{"api_base":"https://api.openai.com/v1","api_key":"sk"}`)},
	}}
	a := newTestAccount(t, db, &fakeVault{})

	keys, err := a.GetKeysForProvider(ctxWithProject("1"), schemas.OpenAI)
	if err != nil {
		t.Fatalf("unexpected rejection with no allowlist configured: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("got %d keys, want 1", len(keys))
	}
}

func TestEgressAllowlist_Matching(t *testing.T) {
	a, err := newEgressAllowlist([]string{
		"vllm.ml.svc.cluster.local:8000",
		"ollama.internal",
		"*.openai.azure.com",
		"*.pinned.example:8443",
	})
	if err != nil {
		t.Fatalf("newEgressAllowlist: %v", err)
	}

	cases := []struct {
		apiBase string
		want    bool
		why     string
	}{
		{"", true, "empty api_base uses the provider default endpoint, which is not tenant-controlled"},
		{"http://vllm.ml.svc.cluster.local:8000/v1", true, "exact host:port"},
		{"http://vllm.ml.svc.cluster.local:9000/v1", false, "the entry pinned port 8000"},
		{"http://ollama.internal:11434", true, "host entry with no port matches any port"},
		{"https://ollama.internal", true, "host entry with no port matches the default port"},
		{"https://tenant.openai.azure.com/", true, "wildcard covers one leading label"},
		{"https://a.b.openai.azure.com/", true, "wildcard covers several leading labels"},
		{"https://openai.azure.com/", false, "wildcard requires at least one leading label"},
		{"https://evil-openai.azure.com.attacker.test/", false, "suffix must be a label boundary, not a substring"},
		{"https://OLLAMA.INTERNAL/v1", true, "host comparison is case-insensitive"},
		{"https://ollama.internal./v1", true, "a trailing FQDN dot must not evade the allowlist"},
		{"https://x.pinned.example:8443/v1", true, "wildcard entry with a pinned port"},
		{"https://x.pinned.example:9999/v1", false, "wildcard entry pinned a different port"},
		{"http://169.254.169.254/latest/meta-data/", false, "cloud metadata endpoint is not allowlisted"},
		{"http://127.0.0.1:8080", false, "loopback is not allowlisted"},
		{"::::not a url", false, "an unparsable api_base must fail closed"},
		{"/relative/path", false, "an api_base with no host must fail closed"},
	}
	for _, tc := range cases {
		if got := a.allows(tc.apiBase); got != tc.want {
			t.Errorf("allows(%q) = %v, want %v — %s", tc.apiBase, got, tc.want, tc.why)
		}
	}
}

func TestEgressAllowlist_Unconfigured(t *testing.T) {
	a, err := newEgressAllowlist(nil)
	if err != nil {
		t.Fatalf("newEgressAllowlist(nil): %v", err)
	}
	if a.configured() {
		t.Fatal("an empty allowlist must report itself unconfigured")
	}
	// With no allowlist the host check is inert; the dialer is what constrains.
	if !a.allows("http://127.0.0.1:8080") {
		t.Fatal("an unconfigured allowlist must not restrict hosts")
	}
}

func TestEgressAllowlist_RejectsMalformedEntries(t *testing.T) {
	for _, bad := range []string{
		"https://host/path",
		"host/path",
		"ev*il.example",
		"*.",
		"a b",
	} {
		if _, err := newEgressAllowlist([]string{bad}); err == nil {
			t.Errorf("newEgressAllowlist(%q) accepted a malformed entry — a typo must not silently "+
				"drop or widen a rule", bad)
		}
	}
}

// TestNew_RejectsMalformedEgressAllowlist proves the parse error reaches the
// composition root, where it becomes a FATAL rather than a silently narrower
// policy than the operator wrote.
func TestNew_RejectsMalformedEgressAllowlist(t *testing.T) {
	_, err := New(Config{DB: &fakeDB{}, Vault: &fakeVault{}, EgressAllowlist: []string{"https://nope/path"}})
	if err == nil {
		t.Fatal("New must reject a malformed GATEWAY_EGRESS_ALLOWLIST entry")
	}
}

// TestEgressAllowlistConfigured_Reported backs the startup log line that tells
// an operator which of the two policy modes is armed.
func TestEgressAllowlistConfigured_Reported(t *testing.T) {
	if newTestAccount(t, &fakeDB{}, &fakeVault{}).EgressAllowlistConfigured() {
		t.Fatal("no allowlist configured, but the account reports one is armed")
	}
	if !newEgressAccount(t, &fakeDB{}, &fakeVault{}, "h.example").EgressAllowlistConfigured() {
		t.Fatal("an allowlist is configured, but the account reports it is not")
	}
}
