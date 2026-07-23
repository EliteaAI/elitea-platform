package main

import (
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/runtimecomposition"
)

func TestValidateRuntimeCompositionRejectsIncompleteIndexDataPlane(t *testing.T) {
	t.Parallel()

	for name, configurations := range map[string]currentConfigurationsConfig{
		"configurations disabled": {},
		"llm facade disabled": {
			Enabled: true,
		},
		"llm base URL missing": {
			Enabled:              true,
			LiteLLMMasterKeyFile: "/run/secrets/litellm-master-key",
		},
		"llm master key missing": {
			Enabled:        true,
			LiteLLMBaseURL: "http://litellm:4000",
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			err := validateRuntimeComposition(
				configurations,
				runtimecomposition.Config{Enabled: true, IndexIngestDispatchEnabled: true},
			)
			if err == nil {
				t.Fatal("incomplete index data plane was accepted")
			}
		})
	}
}

func TestValidateRuntimeCompositionAcceptsCompleteIndexDataPlane(t *testing.T) {
	t.Parallel()

	err := validateRuntimeComposition(
		currentConfigurationsConfig{
			Enabled:              true,
			LiteLLMBaseURL:       "http://litellm:4000",
			LiteLLMMasterKeyFile: "/run/secrets/litellm-master-key",
		},
		runtimecomposition.Config{Enabled: true, IndexIngestDispatchEnabled: true},
	)
	if err != nil {
		t.Fatalf("complete index data plane rejected: %v", err)
	}
}

func TestValidateRuntimeCompositionPreservesIndependentRuntimeModes(t *testing.T) {
	t.Parallel()

	for name, test := range map[string]struct {
		configurations currentConfigurationsConfig
		runtime        runtimecomposition.Config
		wantErr        bool
	}{
		"all disabled": {},
		"validation runtime only": {
			runtime: runtimecomposition.Config{Enabled: true},
		},
		"read-only configurations": {
			configurations: currentConfigurationsConfig{Enabled: true},
		},
		"mutation without runtime": {
			configurations: currentConfigurationsConfig{Enabled: true, MutationEnabled: true},
			wantErr:        true,
		},
		"mutation with runtime": {
			configurations: currentConfigurationsConfig{Enabled: true, MutationEnabled: true},
			runtime:        runtimecomposition.Config{Enabled: true},
		},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			err := validateRuntimeComposition(test.configurations, test.runtime)
			if (err != nil) != test.wantErr {
				t.Fatalf("error=%v wantErr=%v", err, test.wantErr)
			}
		})
	}
}
