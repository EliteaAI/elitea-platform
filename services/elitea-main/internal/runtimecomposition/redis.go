package runtimecomposition

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/redis/go-redis/v9"
)

func newControlRedisClient(ctx context.Context, config Config) (*redis.Client, error) {
	options, err := controlRedisOptions(config)
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(options)
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("ping dedicated runtime Redis: %w", err)
	}
	// PING succeeds only after go-redis AUTHs with the URL username and the
	// file-backed password. Requiring ACL WHOAMI would force a broader command
	// grant than the runtime's XADD/XLEN/EVAL/PING data-plane permissions.
	return client, nil
}

func controlRedisOptions(config Config) (*redis.Options, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	parsed, err := url.Parse(config.RedisURL)
	if err != nil || parsed.User == nil {
		return nil, errors.New("parse dedicated runtime Redis URL")
	}
	password, err := loadPassword(config.RedisPasswordFile)
	if err != nil {
		return nil, err
	}
	roots, err := loadRedisRoots(config.RedisCAFile)
	if err != nil {
		return nil, err
	}
	options, err := redis.ParseURL(config.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("parse dedicated runtime Redis URL: %w", err)
	}
	tlsConfig, err := redisTLSConfig(parsed.Hostname(), roots)
	if err != nil {
		return nil, err
	}
	options.Password = password
	options.TLSConfig = tlsConfig
	options.PoolSize = config.RedisPoolSize
	options.MaxActiveConns = config.RedisPoolSize
	options.MinIdleConns = 0
	options.MaxRetries = -1
	options.DialTimeout = 3 * time.Second
	options.ReadTimeout = 3 * time.Second
	options.WriteTimeout = 3 * time.Second
	options.PoolTimeout = 3 * time.Second
	options.ConnMaxIdleTime = 5 * time.Minute
	options.ConnMaxLifetime = 30 * time.Minute
	return options, nil
}
