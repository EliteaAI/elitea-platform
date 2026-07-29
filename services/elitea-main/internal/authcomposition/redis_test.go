package authcomposition

import (
	"crypto/tls"
	"testing"
)

func TestAuthRedisOptionsAreBoundedTLSACLAndFailFast(t *testing.T) {
	config := writeMaterialFixture(t)
	material, err := materialize(config)
	if err != nil {
		t.Fatal(err)
	}
	defer material.destroy()
	options, err := authRedisOptions(config, material)
	if err != nil {
		t.Fatal(err)
	}
	if options.Addr != "redis.example:6379" || options.Username != "elitea-auth" ||
		options.Password != " redis password " || options.DB != 0 || options.ClientName != "" {
		t.Fatalf("unexpected endpoint/auth options: %+v", options)
	}
	if options.MaxRetries != -1 || options.MinRetryBackoff != -1 || options.MaxRetryBackoff != -1 ||
		options.DialTimeout != authRedisOperationLimit || options.ReadTimeout != authRedisOperationLimit ||
		options.WriteTimeout != authRedisOperationLimit || !options.ContextTimeoutEnabled {
		t.Fatalf("unexpected retry/timeout options: %+v", options)
	}
	if options.PoolSize != authRedisPoolSize || options.MaxActiveConns != authRedisPoolSize ||
		options.MinIdleConns != 0 || options.MaxIdleConns != authRedisMaxIdle ||
		options.PoolTimeout != authRedisOperationLimit {
		t.Fatalf("unexpected pool options: %+v", options)
	}
	if options.TLSConfig == nil || options.TLSConfig.MinVersion != tls.VersionTLS13 ||
		options.TLSConfig.ServerName != "redis.example" ||
		options.TLSConfig.RootCAs != material.redisRoots {
		t.Fatalf("unexpected TLS options: %+v", options.TLSConfig)
	}
}

func TestAuthRedisOptionsRejectIncompleteMaterial(t *testing.T) {
	config := parsedValidConfig(t)
	if _, err := authRedisOptions(config, nil); err == nil {
		t.Fatal("nil material was accepted")
	}
	if _, err := authRedisOptions(config, &materializedFiles{}); err == nil {
		t.Fatal("empty material was accepted")
	}
}
