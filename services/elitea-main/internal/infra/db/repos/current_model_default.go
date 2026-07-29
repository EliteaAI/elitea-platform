package repos

import (
	"context"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/centrysecrets"
)

// SetCurrentModelDefault preserves the current Configurations Vault contract:
// both default-model keys are replaced by one locked vault rewrite.
func (r *CurrentSecretVaultRepository) SetCurrentModelDefault(
	ctx context.Context,
	selection configurationapp.CurrentModelDefaultSelection,
) error {
	target := selection.TargetProjectID
	prefix := "default_" + selection.Section + "_model_"
	return r.MutateProject(ctx, int64(selection.ProjectID), []centrysecrets.Mutation{
		{
			Collection: centrysecrets.RegularSecrets,
			Name:       prefix + "name",
			Value:      selection.Name,
		},
		{
			Collection:   centrysecrets.RegularSecrets,
			Name:         prefix + "project_id",
			IntegerValue: &target,
		},
	})
}
