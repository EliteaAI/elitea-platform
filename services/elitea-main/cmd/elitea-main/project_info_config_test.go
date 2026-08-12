package main

import (
	"strings"
	"testing"
)

func TestCurrentProjectInfoConfigRequiresExplicitBooleanGate(t *testing.T) {
	for _, test := range []struct {
		name    string
		value   string
		present bool
		want    currentProjectInfoConfig
		wantErr string
	}{
		{name: "unset"},
		{name: "explicitly disabled", value: "false", present: true},
		{
			name:    "explicitly enabled",
			value:   "true",
			present: true,
			want:    currentProjectInfoConfig{Enabled: true},
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
			got, err := currentProjectInfoConfigFromEnv(
				func(name string) (string, bool) {
					if name != "ELITEA_PROJECT_INFO_ENABLED" {
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

	if _, err := currentProjectInfoConfigFromEnv(nil); err == nil {
		t.Fatal("nil environment lookup was accepted")
	}
}
