package main

import (
	"strings"
	"testing"
)

func TestCurrentApplicationSkillsConfigRequiresExplicitBooleanGate(t *testing.T) {
	for _, test := range []struct {
		name    string
		value   string
		present bool
		want    currentApplicationSkillsConfig
		wantErr string
	}{
		{name: "unset"},
		{name: "explicitly disabled", value: "false", present: true},
		{
			name:    "explicitly enabled",
			value:   "true",
			present: true,
			want:    currentApplicationSkillsConfig{Enabled: true},
		},
		{
			name:    "uppercase is rejected",
			value:   "TRUE",
			present: true,
			wantErr: "must be true or false",
		},
		{
			name:    "whitespace is rejected",
			value:   " true",
			present: true,
			wantErr: "must be true or false",
		},
		{
			name:    "empty explicit value remains disabled",
			present: true,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := currentApplicationSkillsConfigFromEnv(
				func(name string) (string, bool) {
					if name != "ELITEA_APPLICATION_SKILLS_ENABLED" {
						t.Fatalf("unexpected environment key %q", name)
					}
					return test.value, test.present
				},
			)
			if got != test.want ||
				(test.wantErr == "" && err != nil) ||
				(test.wantErr != "" && (err == nil || !strings.Contains(err.Error(), test.wantErr))) {
				t.Fatalf(
					"config=%+v error=%v; want=%+v error containing %q",
					got,
					err,
					test.want,
					test.wantErr,
				)
			}
		})
	}

	if _, err := currentApplicationSkillsConfigFromEnv(nil); err == nil {
		t.Fatal("nil environment lookup was accepted")
	}
}
