package redisdispatch

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/cutover"
	"github.com/redis/go-redis/v9"
)

type indexCutoverRedisClient interface {
	XLen(context.Context, string) *redis.IntCmd
	XPending(context.Context, string, string) *redis.XPendingCmd
	HLen(context.Context, string) *redis.IntCmd
}

// IndexV2CutoverReader reads the complete version-1 source control route. It
// does not decode a command version: coordinated v1 -> v2 activation requires
// the source stream, PEL and delivery-index hash to be completely empty before
// a new versioned stream/group is activated.
type IndexV2CutoverReader struct {
	client indexCutoverRedisClient
	stream string
	group  string
}

func NewIndexV2CutoverReader(
	client indexCutoverRedisClient,
	stream string,
	group string,
) (*IndexV2CutoverReader, error) {
	if client == nil ||
		!validIndexIngestRoutingName(stream) ||
		!validIndexIngestRoutingName(group) {
		return nil, errors.New("index v2 cutover Redis client, stream and group are required")
	}
	return &IndexV2CutoverReader{client: client, stream: stream, group: group}, nil
}

func (r *IndexV2CutoverReader) ReadIndexControlState(
	ctx context.Context,
) (cutover.IndexControlState, error) {
	if ctx == nil {
		return cutover.IndexControlState{}, errors.New("index v2 cutover context is required")
	}
	if err := ctx.Err(); err != nil {
		return cutover.IndexControlState{}, err
	}
	streamEntries, err := r.client.XLen(ctx, r.stream).Result()
	if err != nil {
		return cutover.IndexControlState{}, cutoverRedisError(ctx, "read index stream length", err)
	}
	pending, err := r.client.XPending(ctx, r.stream, r.group).Result()
	if err != nil {
		return cutover.IndexControlState{}, cutoverRedisError(ctx, "read index pending entries", err)
	}
	deliveryMappings, err := r.client.HLen(ctx, deliveryIndexKey(r.stream)).Result()
	if err != nil {
		return cutover.IndexControlState{}, cutoverRedisError(ctx, "read index delivery mappings", err)
	}
	return cutover.IndexControlState{
		StreamEntries:    streamEntries,
		PendingEntries:   pending.Count,
		DeliveryMappings: deliveryMappings,
	}, nil
}

func cutoverRedisError(ctx context.Context, operation string, err error) error {
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	if strings.Contains(strings.ToUpper(err.Error()), "NOGROUP") {
		return fmt.Errorf("%s: required consumer group is absent", operation)
	}
	return fmt.Errorf("%s: %w", operation, err)
}

var _ cutover.IndexControlStateReader = (*IndexV2CutoverReader)(nil)
