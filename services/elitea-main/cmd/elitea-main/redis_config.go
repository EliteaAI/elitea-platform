package main

import (
	"errors"
	"strings"

	goredis "github.com/redis/go-redis/v9"
)

const defaultRedisAddress = "localhost:6379"

// redisOptionsFromEnv accepts the repository's existing host:port REDIS_URL
// contract and the standard redis:// or rediss:// URL forms. Separate username
// and password variables support the current Centry deployment without placing
// credentials in a tracked Compose file or logging a credential-bearing URL.
func redisOptionsFromEnv(lookup func(string) (string, bool)) (*goredis.Options, error) {
	if lookup == nil {
		return nil, errors.New("environment lookup is required")
	}

	raw, _ := lookup("REDIS_URL")
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = defaultRedisAddress
	}

	var (
		options *goredis.Options
		err     error
	)
	if strings.Contains(raw, "://") {
		options, err = goredis.ParseURL(raw)
		if err != nil {
			return nil, errors.New("REDIS_URL is invalid")
		}
	} else {
		options = &goredis.Options{Addr: raw}
	}

	if username, present := lookup("REDIS_USERNAME"); present && username != "" {
		options.Username = username
	}
	if password, present := lookup("REDIS_PASSWORD"); present && password != "" {
		options.Password = password
	}

	return options, nil
}
