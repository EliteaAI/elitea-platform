package main

import "errors"

type currentApplicationSkillsConfig struct {
	Enabled bool
}

func currentApplicationSkillsConfigFromEnv(
	lookup func(string) (string, bool),
) (currentApplicationSkillsConfig, error) {
	if lookup == nil {
		return currentApplicationSkillsConfig{}, errors.New("current application-skills environment lookup is required")
	}
	enabled, _ := lookup("ELITEA_APPLICATION_SKILLS_ENABLED")
	switch enabled {
	case "", "false":
		return currentApplicationSkillsConfig{}, nil
	case "true":
		return currentApplicationSkillsConfig{Enabled: true}, nil
	default:
		return currentApplicationSkillsConfig{}, errors.New("ELITEA_APPLICATION_SKILLS_ENABLED must be true or false")
	}
}
