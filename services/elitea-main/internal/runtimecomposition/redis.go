package runtimecomposition

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/redis/go-redis/v9"
)

// CutoverRedisConfig is the least-privilege Redis connection surface required
// by the one-shot index cutover preflight. It intentionally excludes command
// signing keys, worker verification keys and listener TLS identities.
type CutoverRedisConfig struct {
	URL          string
	PasswordFile string
	CAFile       string
	PoolSize     int
}

// NewControlRedisClient opens the dedicated, authenticated TLS Redis client
// used by runtime composition and coordinated operator preflight commands.
func NewControlRedisClient(ctx context.Context, config Config) (*redis.Client, error) {
	options, err := controlRedisOptions(config)
	if err != nil {
		return nil, err
	}
	return newControlRedisClient(ctx, options)
}

// NewCutoverControlRedisClient opens the same authenticated TLS Redis
// connection without requiring unrelated production-runtime secrets.
func NewCutoverControlRedisClient(
	ctx context.Context,
	config CutoverRedisConfig,
) (*redis.Client, error) {
	options, err := cutoverRedisOptions(config)
	if err != nil {
		return nil, err
	}
	return newControlRedisClient(ctx, options)
}

func newControlRedisClient(ctx context.Context, options *redis.Options) (*redis.Client, error) {
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
	return cutoverRedisOptions(CutoverRedisConfig{
		URL:          config.RedisURL,
		PasswordFile: config.RedisPasswordFile,
		CAFile:       config.RedisCAFile,
		PoolSize:     config.RedisPoolSize,
	})
}

func cutoverRedisOptions(config CutoverRedisConfig) (*redis.Options, error) {
	if err := validateRedisURL(config.URL); err != nil {
		return nil, err
	}
	if !validPrivateConfigPath(config.PasswordFile) ||
		!validPrivateConfigPath(config.CAFile) {
		return nil, errors.New("runtime Redis secret or CA file path is invalid")
	}
	if config.PoolSize <= 0 || config.PoolSize > maxRedisPoolSize {
		return nil, errors.New("runtime Redis pool size is invalid")
	}
	parsed, err := url.Parse(config.URL)
	if err != nil || parsed.User == nil {
		return nil, errors.New("parse dedicated runtime Redis URL")
	}
	password, err := loadPassword(config.PasswordFile)
	if err != nil {
		return nil, err
	}
	roots, err := loadRedisRoots(config.CAFile)
	if err != nil {
		return nil, err
	}
	options, err := redis.ParseURL(config.URL)
	if err != nil {
		return nil, fmt.Errorf("parse dedicated runtime Redis URL: %w", err)
	}
	tlsConfig, err := redisTLSConfig(parsed.Hostname(), roots)
	if err != nil {
		return nil, err
	}
	options.Password = password
	options.TLSConfig = tlsConfig
	options.PoolSize = config.PoolSize
	options.MaxActiveConns = config.PoolSize
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
