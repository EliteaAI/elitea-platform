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
		{name: "enabled unwrapped", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true",
			"ELITEA_AI_PROJECT_ID":          "1",
		}, want: currentConfigurationsConfig{Enabled: true, PublicProjectID: 1}},
		{name: "enabled wrapped", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED": "true",
			"ELITEA_AI_PROJECT_ID":          "7",
			"ELITEA_VAULT_MASTER_KEY_FILE":  "/run/secrets/centry-vault-master-key",
		}, want: currentConfigurationsConfig{
			Enabled: true, PublicProjectID: 7, VaultMasterKeyFile: "/run/secrets/centry-vault-master-key",
		}},
		{name: "enabled with LiteLLM", values: map[string]string{
			"ELITEA_CONFIGURATIONS_ENABLED":  "true",
			"ELITEA_AI_PROJECT_ID":           "7",
			"ELITEA_LITELLM_BASE_URL":        "https://litellm.internal",
			"ELITEA_LITELLM_MASTER_KEY_FILE": "/run/secrets/litellm-master-key",
		}, want: currentConfigurationsConfig{
			Enabled: true, PublicProjectID: 7, LiteLLMBaseURL: "https://litellm.internal", LiteLLMMasterKeyFile: "/run/secrets/litellm-master-key",
		}},
		{name: "implicit enablement rejected", values: map[string]string{"ELITEA_AI_PROJECT_ID": "1"}, wantErr: true},
		{name: "invalid switch", values: map[string]string{"ELITEA_CONFIGURATIONS_ENABLED": "TRUE"}, wantErr: true},
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
