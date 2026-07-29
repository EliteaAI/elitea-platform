package storage

import (
	"context"
	"errors"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/centrysecrets"
)

var ErrCurrentModelDefaultsUnavailable = errors.New("current model defaults are unavailable")

// CurrentModelDefaultsReader reproduces the current VaultClient lookup path:
// project regular secrets first, then public get_all_secrets precedence
// (public regular, public hidden, admin regular) for each missing field.
type CurrentModelDefaultsReader struct {
	vaults SecretVaultLoader
}

func NewCurrentModelDefaultsReader(vaults SecretVaultLoader) (*CurrentModelDefaultsReader, error) {
	if vaults == nil {
		return nil, errors.New("current model secret vault loader is required")
	}
	return &CurrentModelDefaultsReader{vaults: vaults}, nil
}

func (r *CurrentModelDefaultsReader) Load(
	ctx context.Context,
	projectID, publicProjectID int32,
	section configurationapp.CurrentModelSection,
) (configurationapp.CurrentModelCatalogDefaults, error) {
	if ctx == nil || projectID <= 0 || publicProjectID <= 0 || !configurationapp.IsSupportedCurrentModelSection(section) {
		return configurationapp.CurrentModelCatalogDefaults{}, configurationapp.ErrInvalidCurrentModelCatalogRequest
	}
	if err := ctx.Err(); err != nil {
		return configurationapp.CurrentModelCatalogDefaults{}, err
	}

	projectVault, err := r.vaults.LoadProjectVault(ctx, int64(projectID))
	if err != nil || projectVault == nil {
		return configurationapp.CurrentModelCatalogDefaults{}, currentModelDefaultsFailure(ctx, err)
	}

	var defaults configurationapp.CurrentModelCatalogDefaults
	bindings := currentModelDefaultBindings(section, &defaults)
	needsPublicFallback := false
	for _, binding := range bindings {
		binding.sources.Project, err = readCurrentProjectModelDefault(ctx, projectVault, binding.prefix)
		if err != nil {
			return configurationapp.CurrentModelCatalogDefaults{}, currentModelDefaultsFailure(ctx, err)
		}
		if binding.sources.Project.Name == "" || binding.sources.Project.ProjectID == "" {
			needsPublicFallback = true
		}
	}
	if !needsPublicFallback {
		return defaults, nil
	}

	// EngineBase.get_all_secrets reads admin regular secrets, then overlays the
	// public project's hidden and regular collections. Load the same sources;
	// hidden admin values are deliberately outside this compatibility path.
	adminVault, err := r.vaults.LoadAdminVault(ctx)
	if err != nil || adminVault == nil {
		return configurationapp.CurrentModelCatalogDefaults{}, currentModelDefaultsFailure(ctx, err)
	}
	if err := ctx.Err(); err != nil {
		return configurationapp.CurrentModelCatalogDefaults{}, err
	}
	publicVault := projectVault
	if projectID != publicProjectID {
		publicVault, err = r.vaults.LoadProjectVault(ctx, int64(publicProjectID))
		if err != nil || publicVault == nil {
			return configurationapp.CurrentModelCatalogDefaults{}, currentModelDefaultsFailure(ctx, err)
		}
	}

	for _, binding := range bindings {
		if err := ctx.Err(); err != nil {
			return configurationapp.CurrentModelCatalogDefaults{}, err
		}
		if binding.sources.Project.Name == "" {
			binding.sources.Public.Name, err = lookupCurrentModelNameFromAll(publicVault, adminVault, binding.prefix)
			if err != nil {
				return configurationapp.CurrentModelCatalogDefaults{}, currentModelDefaultsFailure(ctx, err)
			}
		}
		if binding.sources.Project.ProjectID == "" {
			binding.sources.Public.ProjectID, err = lookupCurrentModelProjectIDFromAll(publicVault, adminVault, binding.prefix)
			if err != nil {
				return configurationapp.CurrentModelCatalogDefaults{}, currentModelDefaultsFailure(ctx, err)
			}
		}
	}
	return defaults, nil
}

type currentModelDefaultBinding struct {
	prefix  string
	sources *configurationapp.CurrentModelDefaultSources
}

func currentModelDefaultBindings(
	section configurationapp.CurrentModelSection,
	defaults *configurationapp.CurrentModelCatalogDefaults,
) []currentModelDefaultBinding {
	bindings := []currentModelDefaultBinding{{prefix: string(section), sources: &defaults.Model}}
	if section == configurationapp.CurrentModelSectionLLM {
		bindings = append(bindings,
			currentModelDefaultBinding{prefix: "llm_low_tier", sources: &defaults.LowTier},
			currentModelDefaultBinding{prefix: "llm_high_tier", sources: &defaults.HighTier},
		)
	}
	return bindings
}

func readCurrentProjectModelDefault(
	ctx context.Context,
	vault SecretVault,
	prefix string,
) (configurationapp.CurrentModelDefault, error) {
	if err := ctx.Err(); err != nil {
		return configurationapp.CurrentModelDefault{}, err
	}
	nameKey, projectIDKey := currentModelDefaultKeys(prefix)
	name, err := vault.LookupRegular(nameKey)
	if err != nil && !errors.Is(err, centrysecrets.ErrSecretNotFound) {
		return configurationapp.CurrentModelDefault{}, err
	}
	if errors.Is(err, centrysecrets.ErrSecretNotFound) {
		name = centrysecrets.Secret{}
	}

	projectID, err := vault.LookupRegularProjectID(projectIDKey)
	if err != nil && !errors.Is(err, centrysecrets.ErrSecretNotFound) {
		return configurationapp.CurrentModelDefault{}, err
	}
	if errors.Is(err, centrysecrets.ErrSecretNotFound) {
		projectID = centrysecrets.Secret{}
	}
	return configurationapp.CurrentModelDefault{Name: name.Value, ProjectID: projectID.Value}, nil
}

func lookupCurrentModelNameFromAll(publicVault, adminVault SecretVault, prefix string) (string, error) {
	nameKey, _ := currentModelDefaultKeys(prefix)
	secret, err := publicVault.Lookup(nameKey)
	if err == nil {
		return secret.Value, nil
	}
	if !errors.Is(err, centrysecrets.ErrSecretNotFound) {
		return "", err
	}
	secret, err = adminVault.LookupRegular(nameKey)
	if errors.Is(err, centrysecrets.ErrSecretNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return secret.Value, nil
}

func lookupCurrentModelProjectIDFromAll(publicVault, adminVault SecretVault, prefix string) (string, error) {
	_, projectIDKey := currentModelDefaultKeys(prefix)
	secret, err := publicVault.LookupProjectID(projectIDKey)
	if err == nil {
		return secret.Value, nil
	}
	if !errors.Is(err, centrysecrets.ErrSecretNotFound) {
		return "", err
	}
	secret, err = adminVault.LookupRegularProjectID(projectIDKey)
	if errors.Is(err, centrysecrets.ErrSecretNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return secret.Value, nil
}

func currentModelDefaultKeys(prefix string) (string, string) {
	return "default_" + prefix + "_model_name", "default_" + prefix + "_model_project_id"
}

func currentModelDefaultsFailure(ctx context.Context, err error) error {
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return ErrCurrentModelDefaultsUnavailable
}
