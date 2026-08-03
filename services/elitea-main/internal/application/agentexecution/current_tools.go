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

type CurrentApplicationToolSnapshotService struct {
	settings CurrentAgentToolkitSettingsResolver
	names    CurrentAgentToolkitNameResolver
}

func NewCurrentApplicationToolSnapshotService(
	settings CurrentAgentToolkitSettingsResolver,
	names CurrentAgentToolkitNameResolver,
) (*CurrentApplicationToolSnapshotService, error) {
	if settings == nil || names == nil {
		return nil, errors.New("current agent toolkit snapshot dependencies are required")
	}
	return &CurrentApplicationToolSnapshotService{settings: settings, names: names}, nil
}

// FreezeCurrentApplicationVersion preserves the current generic toolkit shape,
// applies the current per-agent selected_tools restriction, and freezes every
// Configurations reference through the same resolver used by indexing. Toolkit
// behavior remains SDK-owned; this service contains no provider-specific code.
func (service *CurrentApplicationToolSnapshotService) FreezeCurrentApplicationVersion(
	ctx context.Context,
	request CurrentApplicationVersionFreezeRequest,
) (json.RawMessage, error) {
	if service == nil || service.settings == nil || service.names == nil || ctx == nil ||
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
			strings.ContainsAny(toolType, "\x00\r\n") || toolType == "application" {
			// Nested application orchestration has separate cycle, depth, child
			// dispatch and result-reconciliation contracts. Do not silently run it
			// as a regular toolkit before that parity slice is admitted.
			return nil, ErrUnsupportedCurrentAgentStart
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
	return parsed, parsed > 0 && parsed <= math.MaxInt32
}

var _ CurrentApplicationVersionFreezer = (*CurrentApplicationToolSnapshotService)(nil)
