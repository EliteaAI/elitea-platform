package main

import (
	"encoding/base64"
	"errors"
	"math"
	"path/filepath"
	"strconv"
	"strings"
)

const maxCurrentConfigurationsPathBytes = 4096

type currentConfigurationsConfig struct {
	Enabled            bool
	MutationEnabled    bool
	PublicProjectID    int32
	VaultMasterKeyFile string
	// VaultMasterKey is the base64url-encoded SECRETS_MASTER_KEY, the key the
	// secrets handler wraps every project vault key with. The Configurations
	// runtime reads vaults that handler wrote, so it needs the same key; with
	// only VaultMasterKeyFile — which no chart under deploy/ sets — it opened
	// wrapped rows as if they were unwrapped and every model-catalogue read
	// answered 500.
	VaultMasterKey []byte
	// AllowProjectOwnLLMs is product policy, not transport: it decides whether
	// a project may define its own provider credentials and models instead of
	// using only the shared public project's. It is enforced through the
	// lifecycle's status_ok write, and status_ok is a read filter for the
	// Bifrost gateway's credential loader and for the model/embedding
	// catalogues, so it outlived LiteLLM. Its env var was renamed off the
	// retired ELITEA_LITELLM_ prefix accordingly.
	AllowProjectOwnLLMs bool
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
			"ELITEA_ALLOW_PROJECT_OWN_LLMS",
			// Retired with the LiteLLM facade; still rejected here so a stale
			// deployment cannot look configured while being ignored.
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
	// SECRETS_MASTER_KEY is validated but NOT required: the unwrapped shape is
	// a real local one (deploy/scripts/standalone-stack.sh seeds it). It is
	// read only on the enabled path, because the disabled path above rejects
	// Configurations settings and this variable belongs to the secrets
	// handler, which runs either way.
	var masterKey []byte
	if value, present := lookup("SECRETS_MASTER_KEY"); present && value != "" {
		if !validEncodedFernetKey(value) {
			return currentConfigurationsConfig{}, errors.New("SECRETS_MASTER_KEY is invalid")
		}
		masterKey = []byte(value)
	}
	// ELITEA_LITELLM_BASE_URL and ELITEA_LITELLM_MASTER_KEY_FILE are gone with
	// the facade they configured — there is no proxy deployment to address and
	// no administration key to hold. Silently ignoring them is harmless
	// (nothing they enabled still exists), so they are simply no longer read.
	//
	// ELITEA_LITELLM_ALLOW_PROJECT_OWN_LLMS is the opposite case: the policy
	// survives, only its name changed. Ignoring a deployment's `false` would
	// fail OPEN — every project would silently regain permission to define its
	// own LLM credentials, and status_ok would start admitting rows the
	// operator meant to exclude. So the retired name is rejected loudly rather
	// than accepted as a quiet alias. No compose file, Helm chart or values.yaml
	// in this repo sets it, so nothing deployed breaks on the hard rename.
	if _, present := lookup("ELITEA_LITELLM_ALLOW_PROJECT_OWN_LLMS"); present {
		return currentConfigurationsConfig{}, errors.New(
			"ELITEA_LITELLM_ALLOW_PROJECT_OWN_LLMS was renamed to ELITEA_ALLOW_PROJECT_OWN_LLMS",
		)
	}
	allowProjectOwnLLMs := true
	if value, present := lookup("ELITEA_ALLOW_PROJECT_OWN_LLMS"); present {
		switch value {
		case "true":
		case "false":
			allowProjectOwnLLMs = false
		default:
			return currentConfigurationsConfig{}, errors.New("ELITEA_ALLOW_PROJECT_OWN_LLMS must be true or false")
		}
	}
	// Configuration mutation deliberately requires no LLM transport settings at
	// all. The configuration lifecycle used to push each credential and model
	// into the LiteLLM proxy, so a deployment could not accept configuration
	// writes without one. The Bifrost gateway reads the same configuration rows
	// the lifecycle writes, so mutation composes on a gateway-only stack.
	return currentConfigurationsConfig{
		Enabled:             true,
		MutationEnabled:     mutationEnabled,
		PublicProjectID:     int32(parsed),
		VaultMasterKeyFile:  masterKeyFile,
		VaultMasterKey:      masterKey,
		AllowProjectOwnLLMs: allowProjectOwnLLMs,
	}, nil
}

// validEncodedFernetKey accepts exactly what
// storage.NewPostgresSecretVaultLoader accepts: the 44-character base64url
// encoding of a 32-byte key. Checking it here turns a mistyped key into a
// startup error naming the variable, instead of a per-request 500 whose only
// symptom is an empty model picker.
func validEncodedFernetKey(value string) bool {
	if len(value) != 44 {
		return false
	}
	decoded, err := base64.URLEncoding.DecodeString(value)
	return err == nil && len(decoded) == 32
}
