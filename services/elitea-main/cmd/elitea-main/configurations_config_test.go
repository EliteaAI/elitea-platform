package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestCurrentConfigurationsConfigIsExplicitAndMinimal(t *testing.T) {
	tests := []struct {
		name    string
		values  map[string]string
		want    currentConfigurationsConfig
		wantErr bool
	}{
		{name: "disabled", values: map[string]string{}},
		{name: "disabled explicitly", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED":          "false",
			"ELITEA_CONFIGURATIONS_MUTATION_ENABLED": "false",
		}},
		{name: "enabled unwrapped", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true",
			"ELITEA_AI_PROJECT_ID":          "1",
		}, want: currentConfigurationsConfig{Enabled: true, PublicProjectID: 1, AllowProjectOwnLLMs: true}},
		{name: "enabled wrapped", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true",
			"ELITEA_AI_PROJECT_ID":          "7",
			"ELITEA_VAULT_MASTER_KEY_FILE":  "/run/secrets/centry-vault-master-key",
		}, want: currentConfigurationsConfig{
			Enabled: true, PublicProjectID: 7, VaultMasterKeyFile: "/run/secrets/centry-vault-master-key", AllowProjectOwnLLMs: true,
		}},
		// The retired transport settings no longer influence anything: with the
		// facade deleted there is nothing for a base URL or a proxy master key
		// to configure, so they parse to the same config as if unset. This case
		// exists so a reintroduced read shows up as a field difference rather
		// than passing silently.
		{name: "retired LiteLLM transport settings are inert", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED":  "true",
			"ELITEA_AI_PROJECT_ID":           "7",
			"ELITEA_LITELLM_BASE_URL":        "https://litellm.internal",
			"ELITEA_LITELLM_MASTER_KEY_FILE": "/run/secrets/litellm-master-key",
		}, want: currentConfigurationsConfig{
			Enabled: true, PublicProjectID: 7, AllowProjectOwnLLMs: true,
		}},
		{name: "mutation explicitly enabled with complete lifecycle", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED":          "true",
			"ELITEA_CONFIGURATIONS_MUTATION_ENABLED": "true",
			"ELITEA_AI_PROJECT_ID":                   "7",
			"ELITEA_VAULT_MASTER_KEY_FILE":           "/run/secrets/centry-vault-master-key",
		}, want: currentConfigurationsConfig{
			Enabled: true, MutationEnabled: true, PublicProjectID: 7,
			VaultMasterKeyFile:  "/run/secrets/centry-vault-master-key",
			AllowProjectOwnLLMs: true,
		}},
		{name: "project LLM policy disabled", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true",
			"ELITEA_AI_PROJECT_ID":          "7",
			"ELITEA_ALLOW_PROJECT_OWN_LLMS": "false",
		}, want: currentConfigurationsConfig{Enabled: true, PublicProjectID: 7}},
		// The rename is hard, not aliased. Accepting the old name silently would
		// be indistinguishable from ignoring it, and ignoring a `false` fails
		// OPEN: every project would regain permission to define its own LLM
		// credentials and status_ok would start admitting rows the operator
		// meant to exclude. Rejecting it is the only outcome an operator sees.
		{name: "retired policy name is rejected, not aliased", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED":         "true",
			"ELITEA_AI_PROJECT_ID":                  "7",
			"ELITEA_LITELLM_ALLOW_PROJECT_OWN_LLMS": "false",
		}, wantErr: true},
		{name: "retired policy name is rejected even when it agrees with the default", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED":         "true",
			"ELITEA_AI_PROJECT_ID":                  "7",
			"ELITEA_LITELLM_ALLOW_PROJECT_OWN_LLMS": "true",
		}, wantErr: true},
		{name: "implicit enablement rejected", values: map[string]string{"ELITEA_AI_PROJECT_ID": "1"}, wantErr: true},
		{name: "implicit mutation enablement rejected", values: map[string]string{
			"ELITEA_CONFIGURATIONS_MUTATION_ENABLED": "true",
		}, wantErr: true},
		{name: "invalid switch", values: map[string]string{"ELITEA_CONFIGURATIONS_ENABLED": "TRUE"}, wantErr: true},
		{name: "invalid mutation switch", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_CONFIGURATIONS_MUTATION_ENABLED": "TRUE", "ELITEA_AI_PROJECT_ID": "1",
		}, wantErr: true},
		{name: "invalid project LLM policy", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_ALLOW_PROJECT_OWN_LLMS": "yes", "ELITEA_AI_PROJECT_ID": "1",
		}, wantErr: true},
		{name: "missing public project", values: map[string]string{"ELITEA_CONFIGURATIONS_ENABLED": "true"}, wantErr: true},
		{name: "invalid public project", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_AI_PROJECT_ID": "0",
		}, wantErr: true},
		{name: "relative key path", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_AI_PROJECT_ID": "1", "ELITEA_VAULT_MASTER_KEY_FILE": "vault-key",
		}, wantErr: true},
		{name: "mutation with current database vault", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_CONFIGURATIONS_MUTATION_ENABLED": "true", "ELITEA_AI_PROJECT_ID": "1",
		}, want: currentConfigurationsConfig{
			Enabled: true, MutationEnabled: true, PublicProjectID: 1,
			AllowProjectOwnLLMs: true,
		}},
		// Configuration mutation composes without any LiteLLM settings. The
		// lifecycle no longer pushes rows into that proxy — the Bifrost gateway
		// reads them — so requiring its base URL and master key here would keep
		// a gateway-only deployment from accepting configuration writes at all.
		{name: "mutation without LiteLLM lifecycle accepted", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_CONFIGURATIONS_MUTATION_ENABLED": "true", "ELITEA_AI_PROJECT_ID": "1", "ELITEA_VAULT_MASTER_KEY_FILE": "/run/secrets/centry-vault-master-key",
		}, want: currentConfigurationsConfig{
			Enabled: true, MutationEnabled: true, PublicProjectID: 1,
			VaultMasterKeyFile:  "/run/secrets/centry-vault-master-key",
			AllowProjectOwnLLMs: true,
		}},
		// The policy flag survives LiteLLM's removal and must keep parsing:
		// false still means only the public project may define its own LLMs.
		{name: "project-own LLM policy is honoured without LiteLLM settings", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_CONFIGURATIONS_MUTATION_ENABLED": "true", "ELITEA_AI_PROJECT_ID": "1",
			"ELITEA_VAULT_MASTER_KEY_FILE": "/run/secrets/centry-vault-master-key", "ELITEA_ALLOW_PROJECT_OWN_LLMS": "false",
		}, want: currentConfigurationsConfig{
			Enabled: true, MutationEnabled: true, PublicProjectID: 1,
			VaultMasterKeyFile:  "/run/secrets/centry-vault-master-key",
			AllowProjectOwnLLMs: false,
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := currentConfigurationsConfigFromEnv(func(name string) (string, bool) {
				value, ok := test.values[name]
				return value, ok
			})
			if (err != nil) != test.wantErr || !reflect.DeepEqual(got, test.want) {
				t.Fatalf("config=%+v error=%v; want=%+v wantErr=%v", got, err, test.want, test.wantErr)
			}
		})
	}
}

// SECRETS_MASTER_KEY is the key the secrets handler wraps every project vault
// key with. The Configurations runtime reads those vaults, so the same value
// has to reach it: ELITEA_VAULT_MASTER_KEY_FILE is set by no chart under
// deploy/, and with only that source the runtime opened wrapped rows as
// unwrapped — GET /api/v2/configurations/models/{projectID} then answered 500
// for every section while every configuration row was intact.
func TestCurrentConfigurationsConfigCarriesTheSecretsMasterKey(t *testing.T) {
	validKey := strings.Repeat("A", 43) + "="
	base := map[string]string{
		"ELITEA_CONFIGURATIONS_ENABLED": "true",
		"ELITEA_AI_PROJECT_ID":          "1",
	}
	lookupOf := func(values map[string]string) func(string) (string, bool) {
		return func(name string) (string, bool) {
			value, ok := values[name]
			return value, ok
		}
	}

	values := map[string]string{"SECRETS_MASTER_KEY": validKey}
	for name, value := range base {
		values[name] = value
	}
	got, err := currentConfigurationsConfigFromEnv(lookupOf(values))
	if err != nil {
		t.Fatal(err)
	}
	if string(got.VaultMasterKey) != validKey {
		t.Fatalf("master key = %q; want the SECRETS_MASTER_KEY value", string(got.VaultMasterKey))
	}

	// A mistyped key must stop the process at startup, naming the variable.
	// Accepting it would compose a loader that fails once per request instead,
	// and the only visible symptom is an empty model picker.
	values["SECRETS_MASTER_KEY"] = "not-a-fernet-key"
	if _, err := currentConfigurationsConfigFromEnv(lookupOf(values)); err == nil {
		t.Fatal("a malformed SECRETS_MASTER_KEY was accepted")
	}

	// Absent stays supported: that is the unwrapped shape a local stack seeds.
	delete(values, "SECRETS_MASTER_KEY")
	got, err = currentConfigurationsConfigFromEnv(lookupOf(values))
	if err != nil || got.VaultMasterKey != nil {
		t.Fatalf("config=%+v error=%v", got, err)
	}
}

// The disabled path rejects every Configurations setting, but SECRETS_MASTER_KEY
// is not one: it belongs to the secrets handler, which runs either way.
func TestDisabledCurrentConfigurationsIgnoresTheSecretsMasterKey(t *testing.T) {
	got, err := currentConfigurationsConfigFromEnv(func(name string) (string, bool) {
		if name == "SECRETS_MASTER_KEY" {
			return strings.Repeat("A", 43) + "=", true
		}
		return "", false
	})
	if err != nil || got.Enabled || got.VaultMasterKey != nil {
		t.Fatalf("config=%+v error=%v", got, err)
	}
}
