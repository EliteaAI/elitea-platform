package main

import "errors"

type currentIndexTypesConfig struct {
	Enabled bool
}

func currentIndexTypesConfigFromEnv(
	lookup func(string) (string, bool),
) (currentIndexTypesConfig, error) {
	if lookup == nil {
		return currentIndexTypesConfig{}, errors.New("current index-types environment lookup is required")
	}
	enabled, _ := lookup("ELITEA_INDEX_TYPES_ENABLED")
	switch enabled {
	case "", "false":
		return currentIndexTypesConfig{}, nil
	case "true":
		return currentIndexTypesConfig{Enabled: true}, nil
	default:
		return currentIndexTypesConfig{}, errors.New("ELITEA_INDEX_TYPES_ENABLED must be true or false")
	}
}
