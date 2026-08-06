package agentexecution

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strings"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
)

const (
	currentAgentDefaultMaxTokens          = int64(4_000)
	currentAgentReasoningDefaultMaxTokens = int64(16_000)
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
		return nil, ErrUnsupportedCurrentAgentStart
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	version, err := decodeCurrentApplicationVersion(request.VersionDetails)
	if err != nil {
		return nil, ErrUnsupportedCurrentAgentStart
	}
	if err := service.resolveCurrentAgentModel(ctx, request.ProjectID, version); err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return nil, contextErr
		}
		return nil, ErrUnsupportedCurrentAgentStart
	}
	tools, ok := version["tools"].([]any)
	if !ok {
		return nil, ErrUnsupportedCurrentAgentStart
	}
	for index, value := range tools {
		tool, ok := value.(map[string]any)
		if !ok {
			return nil, ErrUnsupportedCurrentAgentStart
		}
		toolType, ok := tool["type"].(string)
		if !ok || toolType == "" || len(toolType) > configurationapp.MaxCurrentToolkitSettingsIdentifier ||
			strings.ContainsAny(toolType, "\x00\r\n") {
			return nil, ErrUnsupportedCurrentAgentStart
		}
		if toolType == "application" {
			frozen, ok := freezeCurrentAdhocApplicationReference(
				tool,
				request.ProjectID,
				request.ActorUserID,
			)
			if !ok {
				return nil, ErrUnsupportedCurrentAgentStart
			}
			tools[index] = frozen
			continue
		}
		toolID, ok := positiveCurrentAgentJSONInteger(tool["id"])
		if !ok {
			return nil, ErrUnsupportedCurrentAgentStart
		}
		settings, ok := tool["settings"].(map[string]any)
		if !ok || settings == nil {
			return nil, ErrUnsupportedCurrentAgentStart
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
			return nil, ErrUnsupportedCurrentAgentStart
		}

		var storedName *string
		if name, exists := tool["name"]; exists && name != nil {
			text, ok := name.(string)
			if !ok {
				return nil, ErrUnsupportedCurrentAgentStart
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
			return nil, ErrUnsupportedCurrentAgentStart
		}
		tool["id"] = toolID
		tool["settings"] = frozen
		tool["toolkit_name"] = toolkitName
		tools[index] = tool
	}
	version["tools"] = tools

	encoded, err := json.Marshal(version)
	if err != nil || !validJSONObject(encoded) || len(encoded) > executiondomain.MaxAgentExecutionInputBytes {
		return nil, ErrUnsupportedCurrentAgentStart
	}
	return encoded, nil
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
	if len(tool) != 11 || !hasToolID || toolID != nil {
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

	return map[string]any{
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
	}, true
}

func boundedCurrentAgentReferenceString(value any, allowEmpty bool) (string, bool) {
	text, ok := value.(string)
	return text, ok && (allowEmpty || text != "") &&
		len(text) <= configurationapp.MaxCurrentToolkitSettingsIdentifier &&
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
		return ErrUnsupportedCurrentAgentStart
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
			return ErrUnsupportedCurrentAgentStart
		}
		modelName = *catalog.DefaultModelName
		modelProjectID = int64(*catalog.DefaultModelProjectID)
		selected, found = selectCurrentAgentModel(
			catalog.Items, modelName, modelProjectID, true, projectID, service.publicProjectID,
		)
		if !found {
			return ErrUnsupportedCurrentAgentStart
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
			return ErrUnsupportedCurrentAgentStart
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
		return nil, ErrUnsupportedCurrentAgentStart
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, ErrUnsupportedCurrentAgentStart
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
