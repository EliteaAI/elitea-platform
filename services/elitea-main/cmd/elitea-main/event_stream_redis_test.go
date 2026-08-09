package main

import (
	"context"
	"net"
	"strings"
	"testing"
)

func envLookup(pairs map[string]string) func(string) (string, bool) {
	return func(key string) (string, bool) {
		value, present := pairs[key]
		return value, present
	}
}

func TestEventStreamRedisClientIsAbsentWithoutRedisURL(t *testing.T) {
	t.Parallel()

	for name, env := range map[string]map[string]string{
		"unset": {},
		"empty": {"REDIS_URL": ""},
		"blank": {"REDIS_URL": "   "},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			client, err := newEventStreamRedisClient(context.Background(), envLookup(env))
			if err != nil {
				t.Fatalf("newEventStreamRedisClient() error = %v, want nil", err)
			}
			if client != nil {
				t.Fatal("newEventStreamRedisClient() returned a client without REDIS_URL; " +
					"deployments with no Redis must keep starting")
			}
		})
	}
}

func TestEventStreamRedisClientRequiresLookup(t *testing.T) {
	t.Parallel()

	if _, err := newEventStreamRedisClient(context.Background(), nil); err == nil {
		t.Fatal("newEventStreamRedisClient(nil) error = nil, want an error")
	}
}

func TestEventStreamRedisClientRejectsInvalidRedisURL(t *testing.T) {
	t.Parallel()

	_, err := newEventStreamRedisClient(
		context.Background(),
		envLookup(map[string]string{"REDIS_URL": "redis://%zz"}),
	)
	if err == nil {
		t.Fatal("newEventStreamRedisClient() error = nil, want an error for an invalid REDIS_URL")
	}
}

// A configured-but-unreachable Redis must fail startup rather than leave
// RouterConfig.RedisClient nil: a nil client silently unregisters
// /api/v2/events/prompt_lib/{projectID} again, which is the whole failure mode
// of #152. Better to refuse to boot than to boot without the route.
func TestEventStreamRedisClientFailsWhenRedisIsUnreachable(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve a port: %v", err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatalf("release the reserved port: %v", err)
	}

	client, err := newEventStreamRedisClient(
		context.Background(),
		envLookup(map[string]string{"REDIS_URL": address}),
	)
	if client != nil {
		t.Error("newEventStreamRedisClient() returned a client for an unreachable Redis")
	}
	if err == nil {
		t.Fatal("newEventStreamRedisClient() error = nil, want a reachability error")
	}
	if !strings.Contains(err.Error(), "REDIS_URL") {
		t.Errorf("newEventStreamRedisClient() error = %q, want it to name REDIS_URL", err)
	}
}
