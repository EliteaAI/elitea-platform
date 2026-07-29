package main

import (
	"errors"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/runtimecomposition"
)

func validateRuntimeComposition(
	configurations currentConfigurationsConfig,
	runtime runtimecomposition.Config,
) error {
	if runtime.IndexIngestDispatchEnabled {
		if !configurations.Enabled {
			return errors.New("runtime index ingest requires current Configurations")
		}
		if configurations.LiteLLMBaseURL == "" || configurations.LiteLLMMasterKeyFile == "" {
			return errors.New("runtime index ingest requires the current LiteLLM facade")
		}
	}
	if configurations.MutationEnabled && !runtime.Enabled {
		return errors.New("current Configurations mutation requires the production runtime")
	}
	return nil
}
