package main

import "testing"

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
		{name: "enabled with LiteLLM", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED":  "true",
			"ELITEA_AI_PROJECT_ID":           "7",
			"ELITEA_LITELLM_BASE_URL":        "https://litellm.internal",
			"ELITEA_LITELLM_MASTER_KEY_FILE": "/run/secrets/litellm-master-key",
		}, want: currentConfigurationsConfig{
			Enabled: true, PublicProjectID: 7, LiteLLMBaseURL: "https://litellm.internal", LiteLLMMasterKeyFile: "/run/secrets/litellm-master-key", AllowProjectOwnLLMs: true,
		}},
		{name: "mutation explicitly enabled with complete lifecycle", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED":          "true",
			"ELITEA_CONFIGURATIONS_MUTATION_ENABLED": "true",
			"ELITEA_AI_PROJECT_ID":                   "7",
			"ELITEA_VAULT_MASTER_KEY_FILE":           "/run/secrets/centry-vault-master-key",
			"ELITEA_LITELLM_BASE_URL":                "https://litellm.internal",
			"ELITEA_LITELLM_MASTER_KEY_FILE":         "/run/secrets/litellm-master-key",
		}, want: currentConfigurationsConfig{
			Enabled: true, MutationEnabled: true, PublicProjectID: 7,
			VaultMasterKeyFile: "/run/secrets/centry-vault-master-key",
			LiteLLMBaseURL:     "https://litellm.internal", LiteLLMMasterKeyFile: "/run/secrets/litellm-master-key",
			AllowProjectOwnLLMs: true,
		}},
		{name: "project LLM policy disabled", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED":         "true",
			"ELITEA_AI_PROJECT_ID":                  "7",
			"ELITEA_LITELLM_ALLOW_PROJECT_OWN_LLMS": "false",
		}, want: currentConfigurationsConfig{Enabled: true, PublicProjectID: 7}},
		{name: "implicit enablement rejected", values: map[string]string{"ELITEA_AI_PROJECT_ID": "1"}, wantErr: true},
		{name: "implicit mutation enablement rejected", values: map[string]string{
			"ELITEA_CONFIGURATIONS_MUTATION_ENABLED": "true",
		}, wantErr: true},
		{name: "invalid switch", values: map[string]string{"ELITEA_CONFIGURATIONS_ENABLED": "TRUE"}, wantErr: true},
		{name: "invalid mutation switch", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_CONFIGURATIONS_MUTATION_ENABLED": "TRUE", "ELITEA_AI_PROJECT_ID": "1",
		}, wantErr: true},
		{name: "invalid project LLM policy", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_LITELLM_ALLOW_PROJECT_OWN_LLMS": "yes", "ELITEA_AI_PROJECT_ID": "1",
		}, wantErr: true},
		{name: "missing public project", values: map[string]string{"ELITEA_CONFIGURATIONS_ENABLED": "true"}, wantErr: true},
		{name: "invalid public project", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_AI_PROJECT_ID": "0",
		}, wantErr: true},
		{name: "relative key path", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_AI_PROJECT_ID": "1", "ELITEA_VAULT_MASTER_KEY_FILE": "vault-key",
		}, wantErr: true},
		{name: "incomplete LiteLLM settings", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_AI_PROJECT_ID": "1", "ELITEA_LITELLM_BASE_URL": "https://litellm.internal",
		}, wantErr: true},
		{name: "relative LiteLLM key", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_AI_PROJECT_ID": "1", "ELITEA_LITELLM_BASE_URL": "https://litellm.internal", "ELITEA_LITELLM_MASTER_KEY_FILE": "key",
		}, wantErr: true},
		{name: "reused vault and LiteLLM key", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_AI_PROJECT_ID": "1", "ELITEA_VAULT_MASTER_KEY_FILE": "/run/secrets/key", "ELITEA_LITELLM_BASE_URL": "https://litellm.internal", "ELITEA_LITELLM_MASTER_KEY_FILE": "/run/secrets/key",
		}, wantErr: true},
		{name: "mutation with current database vault", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_CONFIGURATIONS_MUTATION_ENABLED": "true", "ELITEA_AI_PROJECT_ID": "1", "ELITEA_LITELLM_BASE_URL": "https://litellm.internal", "ELITEA_LITELLM_MASTER_KEY_FILE": "/run/secrets/litellm-master-key",
		}, want: currentConfigurationsConfig{
			Enabled: true, MutationEnabled: true, PublicProjectID: 1,
			LiteLLMBaseURL: "https://litellm.internal", LiteLLMMasterKeyFile: "/run/secrets/litellm-master-key",
			AllowProjectOwnLLMs: true,
		}},
		{name: "mutation without LiteLLM lifecycle rejected", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true", "ELITEA_CONFIGURATIONS_MUTATION_ENABLED": "true", "ELITEA_AI_PROJECT_ID": "1", "ELITEA_VAULT_MASTER_KEY_FILE": "/run/secrets/centry-vault-master-key",
		}, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := currentConfigurationsConfigFromEnv(func(name string) (string, bool) {
				value, ok := test.values[name]
				return value, ok
			})
			if (err != nil) != test.wantErr || got != test.want {
				t.Fatalf("config=%+v error=%v; want=%+v wantErr=%v", got, err, test.want, test.wantErr)
			}
		})
	}
}
