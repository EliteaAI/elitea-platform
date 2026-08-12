package runtimecomposition

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// currentFrozenToolkitConfigurationClaimer adapts the generic claim-time
// Configurations materializer to the narrower index_meta initialization
// contract. It passes only server-derived project/actor identities and the
// already-admitted frozen toolkit bytes.
type currentFrozenToolkitConfigurationClaimer struct {
	materializer storage.ContentMaterializer
}

func newCurrentFrozenToolkitConfigurationClaimer(
	materializer storage.ContentMaterializer,
) (*currentFrozenToolkitConfigurationClaimer, error) {
	if materializer == nil {
		return nil, errors.New("current frozen toolkit materializer is required")
	}
	return &currentFrozenToolkitConfigurationClaimer{materializer: materializer}, nil
}

func (c *currentFrozenToolkitConfigurationClaimer) ClaimFrozenToolkitConfiguration(
	ctx context.Context,
	claim indexingapp.FrozenToolkitConfigurationClaim,
) (json.RawMessage, error) {
	if c == nil || c.materializer == nil || ctx == nil ||
		claim.ResourceProjectID <= 0 || claim.ActorUserID <= 0 ||
		len(claim.ToolkitConfiguration) == 0 ||
		len(claim.ToolkitConfiguration) > executiondomain.MaxInputEntryContentBytes {
		return nil, storage.ErrContentRejected
	}
	materialized, err := c.materializer.MaterializeContent(ctx, storage.ContentAuthorization{
		ResourceProjectID: strconv.FormatInt(int64(claim.ResourceProjectID), 10),
		ActorID:           strconv.FormatInt(int64(claim.ActorUserID), 10),
		CapabilityID:      executiondomain.IndexIngestCapability,
		SemanticRole:      executiondomain.IndexToolkitConfigurationRole,
		ExpectedLength:    int64(len(claim.ToolkitConfiguration)),
	}, claim.ToolkitConfiguration, executiondomain.MaxInputEntryContentBytes)
	if err != nil {
		return nil, err
	}
	return append(json.RawMessage(nil), materialized...), nil
}

var _ indexingapp.FrozenToolkitConfigurationClaimer = (*currentFrozenToolkitConfigurationClaimer)(nil)
