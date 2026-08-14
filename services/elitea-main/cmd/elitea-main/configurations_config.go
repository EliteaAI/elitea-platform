package main

import (
	"errors"
	"math"
	"path/filepath"
	"strconv"
	"strings"
)

const maxCurrentConfigurationsPathBytes = 4096

type currentConfigurationsConfig struct {
	Enabled              bool
	MutationEnabled      bool
	PublicProjectID      int32
	VaultMasterKeyFile   string
	LiteLLMBaseURL       string
	LiteLLMMasterKeyFile string
	AllowProjectOwnLLMs  bool
}

func currentConfigurationsConfigFromEnv(
	lookup func(string) (string, bool),
) (currentConfigurationsConfig, error) {
	if lookup == nil {
		return currentConfigurationsConfig{}, errors.New("current Configurations environment lookup is required")
	}
	enabled, _ := lookup("ELITEA_CONFIGURATIONS_ENABLED")
	switch enabled {
	case "", "false":
		if value, present := lookup("ELITEA_CONFIGURATIONS_MUTATION_ENABLED"); present && value != "" && value != "false" {
			return currentConfigurationsConfig{}, errors.New("current Configurations settings require explicit enablement")
		}
		for _, name := range []string{
			"ELITEA_AI_PROJECT_ID",
			"ELITEA_VAULT_MASTER_KEY_FILE",
			"ELITEA_LITELLM_BASE_URL",
			"ELITEA_LITELLM_MASTER_KEY_FILE",
			"ELITEA_LITELLM_ALLOW_PROJECT_OWN_LLMS",
		} {
			if value, present := lookup(name); present && value != "" {
				return currentConfigurationsConfig{}, errors.New("current Configurations settings require explicit enablement")
			}
		}
		return currentConfigurationsConfig{}, nil
	case "true":
	default:
		return currentConfigurationsConfig{}, errors.New("ELITEA_CONFIGURATIONS_ENABLED must be true or false")
	}

	mutationEnabledValue, _ := lookup("ELITEA_CONFIGURATIONS_MUTATION_ENABLED")
	mutationEnabled := false
	switch mutationEnabledValue {
	case "", "false":
	case "true":
		mutationEnabled = true
	default:
		return currentConfigurationsConfig{}, errors.New("ELITEA_CONFIGURATIONS_MUTATION_ENABLED must be true or false")
	}

	publicProject, present := lookup("ELITEA_AI_PROJECT_ID")
	if !present || publicProject == "" || publicProject != strings.TrimSpace(publicProject) {
		return currentConfigurationsConfig{}, errors.New("ELITEA_AI_PROJECT_ID is required")
	}
	parsed, err := strconv.ParseInt(publicProject, 10, 32)
	if err != nil || parsed <= 0 || parsed > math.MaxInt32 {
		return currentConfigurationsConfig{}, errors.New("ELITEA_AI_PROJECT_ID is invalid")
	}

	masterKeyFile, _ := lookup("ELITEA_VAULT_MASTER_KEY_FILE")
	if masterKeyFile != "" && (!filepath.IsAbs(masterKeyFile) || filepath.Clean(masterKeyFile) != masterKeyFile ||
		len(masterKeyFile) > maxCurrentConfigurationsPathBytes || masterKeyFile != strings.TrimSpace(masterKeyFile) ||
		strings.ContainsAny(masterKeyFile, "\x00\r\n")) {
		return currentConfigurationsConfig{}, errors.New("ELITEA_VAULT_MASTER_KEY_FILE is invalid")
	}
	liteLLMBaseURL, _ := lookup("ELITEA_LITELLM_BASE_URL")
	liteLLMMasterKeyFile, _ := lookup("ELITEA_LITELLM_MASTER_KEY_FILE")
	allowProjectOwnLLMs := true
	if value, present := lookup("ELITEA_LITELLM_ALLOW_PROJECT_OWN_LLMS"); present {
		switch value {
		case "true":
		case "false":
			allowProjectOwnLLMs = false
		default:
			return currentConfigurationsConfig{}, errors.New("ELITEA_LITELLM_ALLOW_PROJECT_OWN_LLMS must be true or false")
		}
	}
	if (liteLLMBaseURL == "") != (liteLLMMasterKeyFile == "") {
		return currentConfigurationsConfig{}, errors.New("LiteLLM base URL and master-key file must be configured together")
	}
	if liteLLMMasterKeyFile != "" && (!filepath.IsAbs(liteLLMMasterKeyFile) || filepath.Clean(liteLLMMasterKeyFile) != liteLLMMasterKeyFile ||
		len(liteLLMMasterKeyFile) > maxCurrentConfigurationsPathBytes || liteLLMMasterKeyFile != strings.TrimSpace(liteLLMMasterKeyFile) ||
		strings.ContainsAny(liteLLMMasterKeyFile, "\x00\r\n") || liteLLMMasterKeyFile == masterKeyFile) {
		return currentConfigurationsConfig{}, errors.New("ELITEA_LITELLM_MASTER_KEY_FILE is invalid")
	}
	if mutationEnabled && (liteLLMBaseURL == "" || liteLLMMasterKeyFile == "") {
		return currentConfigurationsConfig{}, errors.New("configuration mutation requires LiteLLM lifecycle settings")
	}
	return currentConfigurationsConfig{
		Enabled:              true,
		MutationEnabled:      mutationEnabled,
		PublicProjectID:      int32(parsed),
		VaultMasterKeyFile:   masterKeyFile,
		LiteLLMBaseURL:       liteLLMBaseURL,
		LiteLLMMasterKeyFile: liteLLMMasterKeyFile,
		AllowProjectOwnLLMs:  allowProjectOwnLLMs,
	}, nil
}
