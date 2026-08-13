package agentexecution

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"unicode/utf8"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
)

const (
	currentAgentDefaultMaxTokens          = int64(4_000)
	currentAgentReasoningDefaultMaxTokens = int64(16_000)
	currentMaxNestedSkillApplications     = 25
	currentMaxNestedSkills                = 512
	currentMaxNestedSkillIconBytes        = 16 * 1024
	currentNestedSkillRegistryField       = "nested_skill_registry"
)

// CurrentApplicationVersionFreezer converts the current saved application
// version into one immutable admission snapshot. Implementations must keep
// secret references sealed; plaintext is redeemed only after a worker claim.
type CurrentApplicationVersionFreezer interface {
	FreezeCurrentApplicationVersion(
		context.Context,
		CurrentApplicationVersionFreezeRequest,
	) (json.RawMessage, error)
}

type CurrentApplicationVersionFreezeRequest struct {
	ProjectID      int32
	ActorUserID    int32
	VersionDetails json.RawMessage
}

type CurrentAgentToolkitNameRequest struct {
	ProjectID   int32
	UserID      int32
	ToolkitType string
	StoredName  *string
	Settings    map[string]any
}

type CurrentAgentToolkitNameResolver interface {
	ResolveCurrentAgentToolkitName(
		context.Context,
		CurrentAgentToolkitNameRequest,
	) (string, error)
}

type CurrentAgentToolkitSettingsResolver interface {
	Resolve(
		context.Context,
		configurationapp.CurrentToolkitSettingsRequest,
	) (map[string]any, error)
}

type CurrentAgentModelCatalog interface {
	Get(
		context.Context,
		configurationapp.CurrentModelCatalogQuery,
	) (configurationapp.CurrentModelCatalogResponse, error)
}

type CurrentApplicationToolSnapshotService struct {
	settings        CurrentAgentToolkitSettingsResolver
	names           CurrentAgentToolkitNameResolver
	models          CurrentAgentModelCatalog
	publicProjectID int32
}

func NewCurrentApplicationToolSnapshotService(
	settings CurrentAgentToolkitSettingsResolver,
	names CurrentAgentToolkitNameResolver,
	models CurrentAgentModelCatalog,
	publicProjectID int32,
) (*CurrentApplicationToolSnapshotService, error) {
	if settings == nil || names == nil || models == nil || publicProjectID <= 0 {
		return nil, errors.New("current agent toolkit snapshot dependencies are required")
	}
	return &CurrentApplicationToolSnapshotService{
		settings: settings, names: names, models: models, publicProjectID: publicProjectID,
	}, nil
}

// FreezeCurrentApplicationVersion preserves the current generic toolkit shape,
// applies the current per-agent selected_tools restriction, and freezes every
// Configurations reference through the same resolver used by indexing. Toolkit
// behavior remains SDK-owned; this service contains no provider-specific code.
func (service *CurrentApplicationToolSnapshotService) FreezeCurrentApplicationVersion(
	ctx context.Context,
	request CurrentApplicationVersionFreezeRequest,
) (json.RawMessage, error) {
	if service == nil || service.settings == nil || service.names == nil || service.models == nil ||
		service.publicProjectID <= 0 || ctx == nil ||
		request.ProjectID <= 0 || request.ActorUserID <= 0 ||
		!validJSONObject(request.VersionDetails) {
		return nil, unsupportedStart("freeze dependencies or request identity are invalid")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	version, err := decodeCurrentApplicationVersion(request.VersionDetails)
	if err != nil {
		return nil, unsupportedStartBecause("version details are not one decodable JSON object", err)
	}
	if err := service.resolveCurrentAgentModel(ctx, request.ProjectID, version); err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return nil, contextErr
		}
		return nil, unsupportedStartBecause("model resolution", err)
	}
	tools, ok := version["tools"].([]any)
	if !ok {
		return nil, unsupportedStart("version tools is not an array")
	}
	for index, value := range tools {
		tool, ok := value.(map[string]any)
		if !ok {
			return nil, unsupportedStart("a tool entry is not an object")
		}
		toolType, ok := tool["type"].(string)
		if !ok || toolType == "" || len(toolType) > configurationapp.MaxCurrentToolkitSettingsIdentifier ||
			strings.ContainsAny(toolType, "\x00\r\n") {
			return nil, unsupportedStart("a tool entry has no usable type")
		}
		if toolType == "application" {
			var frozen map[string]any
			var ok bool
			if tool["id"] == nil {
				frozen, ok = freezeCurrentAdhocApplicationReference(
					tool,
					request.ProjectID,
					request.ActorUserID,
				)
			} else {
				frozen, ok = freezeCurrentStoredApplicationReference(tool)
			}
			if !ok {
				return nil, unsupportedStart("an application tool reference could not be frozen")
			}
			tools[index] = frozen
			continue
		}
		toolID, ok := positiveCurrentAgentJSONInteger(tool["id"])
		if !ok {
			return nil, unsupportedStart("a tool entry has no positive integer id")
		}
		settings, ok := tool["settings"].(map[string]any)
		if !ok || settings == nil {
			return nil, unsupportedStart("a tool entry has no settings object")
		}
		frozen, err := service.settings.Resolve(
			ctx,
			configurationapp.CurrentToolkitSettingsRequest{
				ToolkitType: toolType,
				Settings:    settings,
				ProjectID:   request.ProjectID,
				UserID:      request.ActorUserID,
				Mode:        configurationapp.CurrentToolkitSettingsReferenceMode,
			},
		)
		if err != nil {
			if contextErr := ctx.Err(); contextErr != nil {
				return nil, contextErr
			}
			return nil, unsupportedStartBecause("toolkit settings resolution", err)
		}

		var storedName *string
		if name, exists := tool["name"]; exists && name != nil {
			text, ok := name.(string)
			if !ok {
				return nil, unsupportedStart("a tool entry name is not a string")
			}
			storedName = &text
		}
		toolkitName, err := service.names.ResolveCurrentAgentToolkitName(
			ctx,
			CurrentAgentToolkitNameRequest{
				ProjectID: request.ProjectID, UserID: request.ActorUserID,
				ToolkitType: toolType, StoredName: storedName, Settings: frozen,
			},
		)
		if err != nil {
			if contextErr := ctx.Err(); contextErr != nil {
				return nil, contextErr
			}
			return nil, unsupportedStartBecause("toolkit name resolution", err)
		}
		tool["id"] = toolID
		tool["settings"] = frozen
		tool["toolkit_name"] = toolkitName
		tools[index] = tool
	}
	version["tools"] = tools

	encoded, err := json.Marshal(version)
	if err != nil || !validJSONObject(encoded) || len(encoded) > executiondomain.MaxAgentExecutionInputBytes {
		return nil, unsupportedStart("the frozen version is unencodable or exceeds the admission size bound")
	}
	return encoded, nil
}

// freezeCurrentStoredApplicationReference preserves the current EliteATool
// application shape used by saved agents and pipelines. Application references
// contain identity only; they must never pass through the generic configuration
// resolver or carry provider credentials in their settings.
func freezeCurrentStoredApplicationReference(tool map[string]any) (map[string]any, bool) {
	toolID, validToolID := positiveCurrentAgentJSONInteger(tool["id"])
	name, validName := boundedCurrentAgentReferenceString(tool["name"], false)
	_, validDescription := optionalBoundedCurrentAgentReferenceString(tool["description"])
	authorID, validAuthorID := positiveCurrentAgentJSONInteger(tool["author_id"])
	toolkitName, validToolkitName := boundedCurrentAgentReferenceString(tool["toolkit_name"], false)
	agentType, validAgentType := boundedCurrentAgentReferenceString(tool["agent_type"], false)
	createdAt, validCreatedAt := boundedCurrentAgentReferenceString(tool["created_at"], false)
	settings, validSettings := tool["settings"].(map[string]any)
	meta, validMeta := tool["meta"].(map[string]any)
	variables, validVariables := tool["variables"].([]any)
	isPinned, validPinned := tool["is_pinned"].(bool)
	if !validToolID || !validName || !validDescription || !validAuthorID ||
		!validToolkitName || toolkitName != name || !validAgentType || !validCreatedAt ||
		!validSettings || len(settings) != 2 || !validMeta || !validVariables || len(variables) != 0 ||
		!validPinned || isPinned || tool["author"] != nil || tool["online"] != nil ||
		tool["icon_meta"] != nil || tool["indexes_count"] != nil {
		return nil, false
	}
	applicationID, validApplicationID := positiveCurrentAgentJSONInteger(settings["application_id"])
	versionID, validVersionID := positiveCurrentAgentJSONInteger(settings["application_version_id"])
	if !validApplicationID || !validVersionID {
		return nil, false
	}
	nestedSkills, validNestedSkills := freezeCurrentNestedSkillRegistry(
		tool[currentNestedSkillRegistryField],
	)
	if !validNestedSkills {
		return nil, false
	}

	tool["id"] = toolID
	tool["author_id"] = authorID
	tool["settings"] = map[string]any{
		"application_id":         applicationID,
		"application_version_id": versionID,
	}
	tool["meta"] = meta
	tool["variables"] = variables
	tool["agent_type"] = agentType
	tool["created_at"] = createdAt
	if nestedSkills == nil {
		delete(tool, currentNestedSkillRegistryField)
	} else {
		tool[currentNestedSkillRegistryField] = nestedSkills
	}
	return tool, true
}

// freezeCurrentAdhocApplicationReference admits only the current same-project
// application reference emitted by ResolveCurrentAdhocTurn. The child application
// remains SDK-owned and is fetched by its application/version identity;
// no child configuration or credential material is copied into the command.
func freezeCurrentAdhocApplicationReference(
	tool map[string]any,
	projectID int32,
	actorUserID int32,
) (map[string]any, bool) {
	toolID, hasToolID := tool["id"]
	_, hasNestedSkills := tool[currentNestedSkillRegistryField]
	expectedFields := 11
	if hasNestedSkills {
		expectedFields++
	}
	if len(tool) != expectedFields || !hasToolID || toolID != nil {
		return nil, false
	}
	name, validName := boundedCurrentAgentReferenceString(tool["name"], false)
	toolkitName, validToolkitName := boundedCurrentAgentReferenceString(tool["toolkit_name"], false)
	description, validDescription := boundedCurrentAgentReferenceString(tool["description"], true)
	agentType, validAgentType := boundedCurrentAgentReferenceString(tool["agent_type"], false)
	createdAt, validCreatedAt := boundedCurrentAgentReferenceString(tool["created_at"], false)
	authorID, validAuthorID := positiveCurrentAgentJSONInteger(tool["author_id"])
	participantID, validParticipantID := positiveCurrentAgentJSONInteger(tool["participant_id"])
	toolProjectID, validProjectID := positiveCurrentAgentJSONInteger(tool["project_id"])
	settings, validSettings := tool["settings"].(map[string]any)
	if !validName || !validToolkitName || name != toolkitName || !validDescription ||
		!validAgentType || !validCreatedAt ||
		!validAuthorID || authorID != int64(actorUserID) || !validParticipantID ||
		!validProjectID || toolProjectID != int64(projectID) || !validSettings ||
		len(settings) != 4 || !emptyCurrentAgentJSONArray(settings["variables"]) ||
		!emptyCurrentAgentJSONArray(settings["selected_tools"]) {
		return nil, false
	}
	applicationID, validApplicationID := positiveCurrentAgentJSONInteger(settings["application_id"])
	versionID, validVersionID := positiveCurrentAgentJSONInteger(settings["application_version_id"])
	if !validApplicationID || !validVersionID {
		return nil, false
	}
	nestedSkills, validNestedSkills := freezeCurrentNestedSkillRegistry(
		tool[currentNestedSkillRegistryField],
	)
	if !validNestedSkills {
		return nil, false
	}

	frozen := map[string]any{
		"type":           "application",
		"name":           name,
		"description":    description,
		"author_id":      authorID,
		"participant_id": participantID,
		"project_id":     toolProjectID,
		"settings": map[string]any{
			"variables":              []any{},
			"application_id":         applicationID,
			"selected_tools":         []any{},
			"application_version_id": versionID,
		},
		"id":           nil,
		"toolkit_name": toolkitName,
		"agent_type":   agentType,
		"created_at":   createdAt,
	}
	if nestedSkills != nil {
		frozen[currentNestedSkillRegistryField] = nestedSkills
	}
	return frozen, true
}

func freezeCurrentNestedSkillRegistry(value any) ([]any, bool) {
	if value == nil {
		return nil, true
	}
	entries, ok := value.([]any)
	if !ok || len(entries) == 0 || len(entries) > currentMaxNestedSkillApplications {
		return nil, false
	}
	result := make([]any, 0, len(entries))
	totalSkills := 0
	seenApplications := make(map[string]struct{}, len(entries))
	for _, rawEntry := range entries {
		entry, ok := rawEntry.(map[string]any)
		if !ok || len(entry) != 4 {
			return nil, false
		}
		applicationID, validApplicationID := positiveCurrentAgentJSONInteger(entry["application_id"])
		versionID, validVersionID := positiveCurrentAgentJSONInteger(entry["application_version_id"])
		applicationName, validApplicationName := boundedCurrentAgentReferenceString(
			entry["application_name"],
			false,
		)
		skills, validSkills := entry["skills"].([]any)
		identity := fmt.Sprintf("%d:%d", applicationID, versionID)
		if !validApplicationID || !validVersionID || !validApplicationName ||
			!validSkills || len(skills) == 0 {
			return nil, false
		}
		if _, duplicate := seenApplications[identity]; duplicate {
			return nil, false
		}
		seenApplications[identity] = struct{}{}
		frozenSkills := make([]any, 0, len(skills))
		seenSkills := make(map[int64]struct{}, len(skills))
		for _, rawSkill := range skills {
			totalSkills++
			if totalSkills > currentMaxNestedSkills {
				return nil, false
			}
			skill, ok := rawSkill.(map[string]any)
			if !ok || len(skill) != 3 {
				return nil, false
			}
			skillID, validSkillID := positiveCurrentAgentJSONInteger(skill["skill_id"])
			name, validName := skill["name"].(string)
			iconMeta := skill["icon_meta"]
			if !validSkillID || !validName || name == "" || !utf8.ValidString(name) ||
				utf8.RuneCountInString(name) > 256 || strings.ContainsAny(name, "\x00\r\n") {
				return nil, false
			}
			if _, duplicate := seenSkills[skillID]; duplicate {
				return nil, false
			}
			seenSkills[skillID] = struct{}{}
			if iconMeta != nil {
				if _, object := iconMeta.(map[string]any); !object {
					return nil, false
				}
				encoded, err := json.Marshal(iconMeta)
				if err != nil || len(encoded) > currentMaxNestedSkillIconBytes {
					return nil, false
				}
			}
			frozenSkills = append(frozenSkills, map[string]any{
				"skill_id": skillID, "name": name, "icon_meta": iconMeta,
			})
		}
		result = append(result, map[string]any{
			"application_id": applicationID, "application_version_id": versionID,
			"application_name": applicationName, "skills": frozenSkills,
		})
	}
	return result, true
}

func boundedCurrentAgentReferenceString(value any, allowEmpty bool) (string, bool) {
	text, ok := value.(string)
	return text, ok && (allowEmpty || text != "") &&
		len(text) <= configurationapp.MaxCurrentToolkitSettingsIdentifier &&
		!strings.ContainsAny(text, "\x00\r\n")
}

func optionalBoundedCurrentAgentReferenceString(value any) (*string, bool) {
	if value == nil {
		return nil, true
	}
	text, ok := value.(string)
	return &text, ok && len(text) <= configurationapp.MaxCurrentToolkitSettingsIdentifier &&
		!strings.ContainsAny(text, "\x00\r\n")
}

func emptyCurrentAgentJSONArray(value any) bool {
	items, ok := value.([]any)
	return ok && len(items) == 0
}

func (service *CurrentApplicationToolSnapshotService) resolveCurrentAgentModel(
	ctx context.Context,
	projectID int32,
	version map[string]any,
) error {
	settings, ok := version["llm_settings"].(map[string]any)
	if !ok || settings == nil {
		return unsupportedStart("the turn carries no llm_settings object")
	}
	// This is Configurations-owned metadata. A stored or caller-projected value
	// must never select the SDK model client implementation.
	delete(settings, "openai_compatible")

	catalog, err := service.models.Get(ctx, configurationapp.CurrentModelCatalogQuery{
		Section: configurationapp.CurrentModelSectionLLM, ProjectID: projectID,
		PublicProjectID: service.publicProjectID, IncludeShared: true,
	})
	if err != nil {
		return err
	}
	modelName, _ := settings["model_name"].(string)
	modelProjectID, modelProjectSet := positiveCurrentAgentJSONInteger(settings["model_project_id"])
	selected, found := selectCurrentAgentModel(
		catalog.Items, modelName, modelProjectID, modelProjectSet, projectID, service.publicProjectID,
	)
	if !found {
		if catalog.DefaultModelName == nil || catalog.DefaultModelProjectID == nil ||
			*catalog.DefaultModelName == "" || *catalog.DefaultModelProjectID <= 0 {
			return unsupportedStart("the requested model is not in the project's catalog and the catalog names no default")
		}
		modelName = *catalog.DefaultModelName
		modelProjectID = int64(*catalog.DefaultModelProjectID)
		selected, found = selectCurrentAgentModel(
			catalog.Items, modelName, modelProjectID, true, projectID, service.publicProjectID,
		)
		if !found {
			return unsupportedStart("the catalog's default model is not itself in the catalog")
		}
		settings["model_name"] = modelName
		settings["model_project_id"] = modelProjectID
		normalizeCurrentAgentModelFamily(settings, selected.SupportsReasoning)
	} else {
		if !modelProjectSet {
			settings["model_project_id"] = int64(selected.ProjectID)
		}
		if currentAgentModelFamilyConflict(settings) {
			normalizeCurrentAgentModelFamily(settings, selected.SupportsReasoning)
		}
	}
	compatible := false
	if selected.OpenAICompatible != nil {
		compatible = *selected.OpenAICompatible
	}
	if value, exists := settings["max_tokens"]; exists && value != nil {
		maxTokens, valid := currentAgentJSONInteger(value)
		if !valid || maxTokens == 0 || maxTokens < -1 || maxTokens > math.MaxInt32 {
			return unsupportedStart("max_tokens is out of the admitted range")
		}
		if maxTokens == -1 {
			maxTokens = currentAgentDefaultMaxTokens
			if selected.SupportsReasoning != nil && *selected.SupportsReasoning {
				maxTokens = currentAgentReasoningDefaultMaxTokens
			}
		}
		settings["max_tokens"] = maxTokens
	}
	settings["openai_compatible"] = compatible
	version["llm_settings"] = settings
	return nil
}

func selectCurrentAgentModel(
	items []configurationapp.CurrentModelCatalogItem,
	name string,
	modelProjectID int64,
	modelProjectSet bool,
	projectID int32,
	publicProjectID int32,
) (configurationapp.CurrentModelCatalogItem, bool) {
	if name == "" || (modelProjectSet && (modelProjectID <= 0 || modelProjectID > math.MaxInt32)) {
		return configurationapp.CurrentModelCatalogItem{}, false
	}
	if modelProjectSet {
		for _, item := range items {
			if item.Name == name && int64(item.ProjectID) == modelProjectID {
				return item, true
			}
		}
		return configurationapp.CurrentModelCatalogItem{}, false
	}
	for _, preferredProject := range []int32{projectID, publicProjectID} {
		for _, item := range items {
			if item.Name == name && item.ProjectID == preferredProject {
				return item, true
			}
		}
	}
	return configurationapp.CurrentModelCatalogItem{}, false
}

func currentAgentModelFamilyConflict(settings map[string]any) bool {
	_, hasTemperature := settings["temperature"]
	if !hasTemperature || settings["temperature"] == nil {
		return false
	}
	reasoning, _ := settings["reasoning_effort"].(string)
	return reasoning != "" && reasoning != "none"
}

func normalizeCurrentAgentModelFamily(settings map[string]any, supportsReasoning *bool) {
	reasoning := supportsReasoning != nil && *supportsReasoning
	if reasoning {
		settings["temperature"] = nil
		if effort, _ := settings["reasoning_effort"].(string); effort == "" {
			settings["reasoning_effort"] = "medium"
		}
		return
	}
	settings["reasoning_effort"] = nil
	if value, exists := settings["temperature"]; !exists || value == nil {
		settings["temperature"] = 0.7
	}
}

func decodeCurrentApplicationVersion(source []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(source))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil || value == nil {
		return nil, unsupportedStart("version details are not a JSON object")
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, unsupportedStart("version details carry trailing JSON")
	}
	return value, nil
}

func positiveCurrentAgentJSONInteger(value any) (int64, bool) {
	parsed, valid := currentAgentJSONInteger(value)
	return parsed, valid && parsed > 0 && parsed <= math.MaxInt32
}

func currentAgentJSONInteger(value any) (int64, bool) {
	var parsed int64
	switch typed := value.(type) {
	case json.Number:
		integer, err := typed.Int64()
		if err != nil {
			return 0, false
		}
		parsed = integer
	case int32:
		parsed = int64(typed)
	case int64:
		parsed = typed
	case int:
		parsed = int64(typed)
	default:
		return 0, false
	}
	return parsed, true
}

var _ CurrentApplicationVersionFreezer = (*CurrentApplicationToolSnapshotService)(nil)
