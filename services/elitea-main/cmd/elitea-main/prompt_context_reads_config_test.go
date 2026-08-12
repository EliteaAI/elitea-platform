package main

import "testing"

func TestCurrentPromptContextReadsConfigFromEnv(t *testing.T) {
	for _, test := range []struct {
		name    string
		value   string
		present bool
		enabled bool
		wantErr bool
	}{
		{name: "unset"},
		{name: "false", value: "false", present: true},
		{name: "true", value: "true", present: true, enabled: true},
		{name: "uppercase rejected", value: "TRUE", present: true, wantErr: true},
		{name: "whitespace rejected", value: " true", present: true, wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			config, err := currentPromptContextReadsConfigFromEnv(
				func(name string) (string, bool) {
					if name != "ELITEA_PROMPT_CONTEXT_READS_ENABLED" {
						t.Fatalf("unexpected environment name %q", name)
					}
					return test.value, test.present
				},
			)
			if (err != nil) != test.wantErr || config.Enabled != test.enabled {
				t.Fatalf("config=%+v error=%v", config, err)
			}
		})
	}
	if _, err := currentPromptContextReadsConfigFromEnv(nil); err == nil {
		t.Fatal("nil environment lookup was accepted")
	}
}
