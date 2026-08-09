package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// eventStreamPingTimeout bounds the startup reachability probe. A configured but
// unreachable Redis is a misconfiguration we want to surface at boot, not a
// 500 on the first SSE subscribe hours later.
const eventStreamPingTimeout = 5 * time.Second

// newEventStreamRedisClient opens the Redis connection that backs the project
// SSE stream (`RouterConfig.RedisClient`, mounted at
// `/api/v2/events/prompt_lib/{projectID}` by internal/api/router.go).
//
// Why Redis and not the `EventSource` (NATS) arm of that same gate: every
// elitea-main deployment in this repository already runs Redis and already
// passes REDIS_URL — deploy/docker-compose.yml, deploy/docker-compose.e2e-
// standalone.yml and deploy/helm/elitea-main/values-staging.yaml all set it —
// while no elitea-main deployment is given a NATS endpoint. The NATS EventBus
// (internal/infra/natsbus) is wired for elitea-llm-gateway, and elitea-main's
// only NATS-shaped env var is GATEWAY_NATS_URL, which is the gateway *client*.
// Choosing EventSource here would mount the route against a broker that is not
// deployed. When elitea-main's own bus moves to NATS, this returns the
// EventBus instead and the router's first branch takes over unchanged.
//
// Returns (nil, nil) when REDIS_URL is absent or empty, so deployments that
// genuinely have no Redis keep starting — the route then stays unmounted, which
// TestNilGatedRouterFieldsAreWiredOrDeclared's fallback-pair rule now makes a
// visible, declared state rather than an accidental one.
func newEventStreamRedisClient(
	ctx context.Context,
	lookup func(string) (string, bool),
) (*goredis.Client, error) {
	if lookup == nil {
		return nil, errors.New("environment lookup is required")
	}
	raw, present := lookup("REDIS_URL")
	if !present || strings.TrimSpace(raw) == "" {
		return nil, nil
	}

	options, err := redisOptionsFromEnv(lookup)
	if err != nil {
		return nil, err
	}

	client := goredis.NewClient(options)
	pingCtx, cancel := context.WithTimeout(ctx, eventStreamPingTimeout)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("verify REDIS_URL reachability: %w", err)
	}
	return client, nil
}
