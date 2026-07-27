package main

import "errors"

type currentPromptContextReadsConfig struct {
	Enabled bool
}

func currentPromptContextReadsConfigFromEnv(
	lookup func(string) (string, bool),
) (currentPromptContextReadsConfig, error) {
	if lookup == nil {
		return currentPromptContextReadsConfig{}, errors.New("current prompt-context reads environment lookup is required")
	}
	enabled, _ := lookup("ELITEA_PROMPT_CONTEXT_READS_ENABLED")
	switch enabled {
	case "", "false":
		return currentPromptContextReadsConfig{}, nil
	case "true":
		return currentPromptContextReadsConfig{Enabled: true}, nil
	default:
		return currentPromptContextReadsConfig{}, errors.New("ELITEA_PROMPT_CONTEXT_READS_ENABLED must be true or false")
	}
}
