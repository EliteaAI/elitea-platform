package repos

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/jackc/pgx/v5"
)

const (
	currentMaxAgentNestingTiers      = 3
	currentMaxApplicationNestingHops = 25
)

var errInvalidCurrentApplicationNesting = errors.New("invalid current application nesting")

type currentApplicationNestingQuerier interface {
	ResolveCurrentApplicationNestingNode(
		context.Context,
		int32,
	) (sqlcgen.ResolveCurrentApplicationNestingNodeRow, error)
}

type currentApplicationNestingKey struct {
	applicationID int32
	versionID     int32
}

type currentApplicationNestingReference struct {
	ToolID               int32           `json:"tool_id"`
	ToolName             *string         `json:"tool_name"`
	ApplicationID        json.RawMessage `json:"application_id"`
	ApplicationVersionID json.RawMessage `json:"application_version_id"`
}

type currentApplicationNestingNode struct {
	versionID     int32
	applicationID int32
	agentType     string
	children      []currentApplicationNestingReference
}

func validateCurrentApplicationNesting(
	ctx context.Context,
	queries currentApplicationNestingQuerier,
	versionID int32,
	startDepth int,
) error {
	if ctx == nil || queries == nil || versionID <= 0 || startDepth <= 0 {
		return errInvalidCurrentApplicationNesting
	}
	cache := make(map[int32]currentApplicationNestingNode)
	load := func(versionID int32) (currentApplicationNestingNode, error) {
		if node, ok := cache[versionID]; ok {
			return node, nil
		}
		row, err := queries.ResolveCurrentApplicationNestingNode(ctx, versionID)
		if errors.Is(err, pgx.ErrNoRows) {
			return currentApplicationNestingNode{}, fmt.Errorf(
				"%w: application version %d does not exist",
				errInvalidCurrentApplicationNesting,
				versionID,
			)
		}
		if err != nil {
			return currentApplicationNestingNode{}, fmt.Errorf(
				"resolve application nesting node %d: %w",
				versionID,
				err,
			)
		}
		node, err := decodeCurrentApplicationNestingNode(row)
		if err != nil {
			return currentApplicationNestingNode{}, err
		}
		cache[versionID] = node
		return node, nil
	}

	root, err := load(versionID)
	if err != nil {
		return err
	}
	agentTiers := startDepth - 1 + currentApplicationAgentTierContribution(root.agentType)
	path := make(map[currentApplicationNestingKey]struct{})
	for _, child := range root.children {
		if err := walkCurrentApplicationNesting(
			ctx,
			load,
			child,
			agentTiers,
			1,
			path,
		); err != nil {
			return err
		}
	}
	return nil
}

func walkCurrentApplicationNesting(
	ctx context.Context,
	load func(int32) (currentApplicationNestingNode, error),
	reference currentApplicationNestingReference,
	agentTiers int,
	rawDepth int,
	path map[currentApplicationNestingKey]struct{},
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	applicationID, validApplicationID := positiveCurrentApplicationNestingInteger(reference.ApplicationID)
	versionID, validVersionID := positiveCurrentApplicationNestingInteger(reference.ApplicationVersionID)
	if reference.ToolID <= 0 || !validApplicationID || !validVersionID {
		return fmt.Errorf(
			"%w: application tool %d has an incomplete child reference",
			errInvalidCurrentApplicationNesting,
			reference.ToolID,
		)
	}
	key := currentApplicationNestingKey{applicationID: applicationID, versionID: versionID}
	if _, exists := path[key]; exists {
		return fmt.Errorf(
			"%w: circular reference to application %d version %d",
			errInvalidCurrentApplicationNesting,
			applicationID,
			versionID,
		)
	}
	if rawDepth > currentMaxApplicationNestingHops {
		return fmt.Errorf(
			"%w: application nesting exceeds %d raw hops",
			errInvalidCurrentApplicationNesting,
			currentMaxApplicationNestingHops,
		)
	}

	node, err := load(versionID)
	if err != nil {
		return err
	}
	currentAgentTiers := agentTiers + currentApplicationAgentTierContribution(node.agentType)
	if node.agentType != "pipeline" && len(node.children) > 0 &&
		currentAgentTiers >= currentMaxAgentNestingTiers {
		return fmt.Errorf(
			"%w: agent version %d is a container at tier %d",
			errInvalidCurrentApplicationNesting,
			versionID,
			currentAgentTiers,
		)
	}

	path[key] = struct{}{}
	defer delete(path, key)
	for _, child := range node.children {
		if err := walkCurrentApplicationNesting(
			ctx,
			load,
			child,
			currentAgentTiers,
			rawDepth+1,
			path,
		); err != nil {
			return err
		}
	}
	return nil
}

func decodeCurrentApplicationNestingNode(
	row sqlcgen.ResolveCurrentApplicationNestingNodeRow,
) (currentApplicationNestingNode, error) {
	if row.ApplicationVersionID <= 0 || row.ApplicationID <= 0 ||
		!json.Valid([]byte(row.ChildApplicationsJson)) {
		return currentApplicationNestingNode{}, errInvalidCurrentApplicationNesting
	}
	var children []currentApplicationNestingReference
	decoder := json.NewDecoder(bytes.NewReader([]byte(row.ChildApplicationsJson)))
	if err := decoder.Decode(&children); err != nil || children == nil {
		return currentApplicationNestingNode{}, errInvalidCurrentApplicationNesting
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return currentApplicationNestingNode{}, errInvalidCurrentApplicationNesting
	}
	return currentApplicationNestingNode{
		versionID:     row.ApplicationVersionID,
		applicationID: row.ApplicationID,
		agentType:     row.AgentType,
		children:      children,
	}, nil
}

func positiveCurrentApplicationNestingInteger(raw json.RawMessage) (int32, bool) {
	var value int64
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil || value <= 0 || value > math.MaxInt32 {
		return 0, false
	}
	return int32(value), true
}

func currentApplicationAgentTierContribution(agentType string) int {
	if agentType == "pipeline" {
		return 0
	}
	return 1
}

func filterCurrentAdhocApplicationNesting(
	ctx context.Context,
	queries currentApplicationNestingQuerier,
	tools json.RawMessage,
) (json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(tools))
	decoder.UseNumber()
	var items []any
	if err := decoder.Decode(&items); err != nil || items == nil {
		return nil, errInvalidCurrentApplicationNesting
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, errInvalidCurrentApplicationNesting
	}

	filtered := make([]any, 0, len(items))
	for _, item := range items {
		tool, ok := item.(map[string]any)
		if !ok {
			return nil, errInvalidCurrentApplicationNesting
		}
		toolType, _ := tool["type"].(string)
		if toolType != "application" {
			filtered = append(filtered, tool)
			continue
		}
		settings, ok := tool["settings"].(map[string]any)
		if !ok {
			continue
		}
		versionID, ok := positiveCurrentApplicationNestingValue(settings["application_version_id"])
		if !ok {
			continue
		}
		err := validateCurrentApplicationNesting(ctx, queries, versionID, 2)
		if err == nil {
			filtered = append(filtered, tool)
			continue
		}
		if contextErr := ctx.Err(); contextErr != nil {
			return nil, contextErr
		}
		if !errors.Is(err, errInvalidCurrentApplicationNesting) {
			return nil, err
		}
	}

	encoded, err := json.Marshal(filtered)
	if err != nil || !json.Valid(encoded) {
		return nil, errInvalidCurrentApplicationNesting
	}
	return encoded, nil
}

func positiveCurrentApplicationNestingValue(value any) (int32, bool) {
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
	if parsed <= 0 || parsed > math.MaxInt32 {
		return 0, false
	}
	return int32(parsed), true
}
