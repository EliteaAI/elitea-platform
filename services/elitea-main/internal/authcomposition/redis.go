package authcomposition

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	authRedisPoolSize       = 32
	authRedisMaxIdle        = 8
	authRedisOperationLimit = 3 * time.Second
)

func newAuthRedisClient(
	ctx context.Context,
	config Config,
	material *materializedFiles,
) (*redis.Client, error) {
	options, err := authRedisOptions(config, material)
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(options)
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("ping dedicated Auth Redis: %w", err)
	}
	// PING succeeds only after TLS server authentication and ACL AUTH. Requiring
	// WHOAMI would unnecessarily widen the command grant for this client.
	return client, nil
}

func authRedisOptions(config Config, material *materializedFiles) (*redis.Options, error) {
	if err := config.Validate(); err != nil || material == nil || len(material.redisPassword) == 0 ||
		material.redisRoots == nil {
		return nil, errors.New("invalid Auth Redis composition")
	}
	parsed, err := url.Parse(config.Redis.URL)
	if err != nil || parsed.User == nil || parsed.Hostname() == "" {
		return nil, errors.New("invalid Auth Redis URL")
	}
	options, err := redis.ParseURL(config.Redis.URL)
	if err != nil {
		return nil, errors.New("invalid Auth Redis URL")
	}
	// go-redis requires a string credential and retains it for reconnects. The
	// temporary byte snapshot is still cleared after client construction; this
	// single typed dependency-owned copy is unavoidable until the client offers
	// a byte-oriented credential provider.
	options.Password = string(material.redisPassword)
	options.MaxRetries = -1
	options.MinRetryBackoff = -1
	options.MaxRetryBackoff = -1
	options.DialTimeout = authRedisOperationLimit
	options.ReadTimeout = authRedisOperationLimit
	options.WriteTimeout = authRedisOperationLimit
	options.ContextTimeoutEnabled = true
	options.PoolSize = authRedisPoolSize
	options.MaxActiveConns = authRedisPoolSize
	options.MinIdleConns = 0
	options.MaxIdleConns = authRedisMaxIdle
	options.PoolTimeout = authRedisOperationLimit
	options.ConnMaxIdleTime = 5 * time.Minute
	options.ConnMaxLifetime = 30 * time.Minute
	options.TLSConfig = &tls.Config{
		MinVersion: tls.VersionTLS13,
		ServerName: parsed.Hostname(),
		RootCAs:    material.redisRoots,
	}
	return options, nil
}
