package litellm

import (
	"strconv"
	"strings"
	"unicode"
)

const allTeamModels = "all-team-models"

// ProjectEntities is the provider-side projection for one current project.
// Configurations remains responsible for invoking the lifecycle and persisting
// the generated key; this value contains no credential material.
type ProjectEntities struct {
	TeamAlias  string
	KeyAlias   string
	TeamModels []string
	KeyModels  []string
}

// ProjectEntityProjection preserves current project_entities.py naming and
// model membership. Imported, non-project-prefixed models retain LiteLLM list
// order. Empty model names are ignored exactly as in the current implementation.
func ProjectEntityProjection(projectID, publicProjectID int64, models []ModelRecord) (ProjectEntities, error) {
	if projectID <= 0 || publicProjectID <= 0 || len(models) > maxAdminModelMembershipItems {
		return ProjectEntities{}, ErrInvalidProjection
	}
	projectText := strconv.FormatInt(projectID, 10)
	teamModels := make([]string, 0, len(models)+2)
	teamModels = append(teamModels, projectText+"_*")
	if publicProjectID != projectID {
		teamModels = append(teamModels, strconv.FormatInt(publicProjectID, 10)+"_*")
	}
	for _, model := range models {
		if model.ModelName == "" || projectPrefixedModel(model.ModelName) {
			continue
		}
		if !validAdminIdentifier(model.ModelName) || len(teamModels) == maxAdminModelMembershipItems {
			return ProjectEntities{}, ErrInvalidProjection
		}
		teamModels = append(teamModels, model.ModelName)
	}
	return ProjectEntities{
		TeamAlias:  "project_" + projectText,
		KeyAlias:   "project_key_" + projectText,
		TeamModels: teamModels,
		KeyModels:  []string{allTeamModels},
	}, nil
}

// projectPrefixedModel matches the current Python ^\d+_ classification without
// treating names such as "gpt_4" as project-owned.
func projectPrefixedModel(modelName string) bool {
	underscore := strings.IndexByte(modelName, '_')
	if underscore <= 0 {
		return false
	}
	for _, character := range modelName[:underscore] {
		if !unicode.IsDigit(character) {
			return false
		}
	}
	return true
}
