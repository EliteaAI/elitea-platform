package main

import "errors"

type currentProjectInfoConfig struct {
	Enabled bool
}

func currentProjectInfoConfigFromEnv(
	lookup func(string) (string, bool),
) (currentProjectInfoConfig, error) {
	if lookup == nil {
		return currentProjectInfoConfig{}, errors.New("current project-info environment lookup is required")
	}
	enabled, _ := lookup("ELITEA_PROJECT_INFO_ENABLED")
	switch enabled {
	case "", "false":
		return currentProjectInfoConfig{}, nil
	case "true":
		return currentProjectInfoConfig{Enabled: true}, nil
	default:
		return currentProjectInfoConfig{}, errors.New("ELITEA_PROJECT_INFO_ENABLED must be true or false")
	}
}
