package runtimecomposition

import (
	"strings"
	"testing"
)

func TestConfigFromEnvIsDisabledByDefaultAndFailClosedWhenEnabled(t *testing.T) {
	disabled, err := ConfigFromEnv(mapLookup(map[string]string{}))
	if err != nil {
		t.Fatal(err)
	}
	if disabled.Enabled {
		t.Fatal("runtime unexpectedly enabled")
	}

	_, err = ConfigFromEnv(mapLookup(map[string]string{"ELITEA_RUNTIME_ENABLED": "true"}))
	if err == nil || !strings.Contains(err.Error(), "ELITEA_RUNTIME_COMMAND_STREAM") {
		t.Fatalf("missing enabled config error = %v", err)
	}

	_, err = ConfigFromEnv(mapLookup(map[string]string{"ELITEA_RUNTIME_ENABLED": "yes"}))
	if err == nil {
		t.Fatal("non-boolean runtime enable value was accepted")
	}
}

func TestConfigFromEnvAcceptsCompleteBoundedProductionConfig(t *testing.T) {
	config, err := ConfigFromEnv(mapLookup(validEnvironment()))
	if err != nil {
		t.Fatal(err)
	}
	if !config.Enabled || config.RedisPoolSize != 8 || config.MaxOutstanding != 128 || config.StreamMaxEntries != 256 {
		t.Fatalf("unexpected runtime config: %+v", config)
	}
}

func TestConfigRedisURLContract(t *testing.T) {
	tests := []struct {
		name string
		url  string
	}{
		{name: "plaintext", url: "redis://runtime@redis.internal:6379/0"},
		{name: "missing username", url: "rediss://redis.internal:6379/0"},
		{name: "password in URL", url: "rediss://runtime:secret@redis.internal:6379/0"},
		{name: "query", url: "rediss://runtime@redis.internal:6379/0?protocol=2"},
		{name: "fragment", url: "rediss://runtime@redis.internal:6379/0#fragment"},
		{name: "missing port", url: "rediss://runtime@redis.internal/0"},
		{name: "leading-zero port", url: "rediss://runtime@redis.internal:06379/0"},
		{name: "missing database path", url: "rediss://runtime@redis.internal:6379"},
		{name: "nonzero database", url: "rediss://runtime@redis.internal:6379/1"},
		{name: "noncanonical database", url: "rediss://runtime@redis.internal:6379/01"},
		{name: "encoded username", url: "rediss://runtime%2Dworker@redis.internal:6379/0"},
		{name: "unsupported username character", url: "rediss://runtime+worker@redis.internal:6379/0"},
		{name: "unicode username", url: "rediss://runtimé@redis.internal:6379/0"},
		{name: "unicode host", url: "rediss://runtime@rédis.internal:6379/0"},
		{name: "leading whitespace", url: " rediss://runtime@redis.internal:6379/0"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			environment := validEnvironment()
			environment["ELITEA_RUNTIME_REDIS_URL"] = test.url
			if _, err := ConfigFromEnv(mapLookup(environment)); err == nil {
				t.Fatalf("invalid Redis URL %q was accepted", test.url)
			}
		})
	}
}

func mapLookup(values map[string]string) LookupEnv {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}

func validEnvironment() map[string]string {
	values := map[string]string{
		"ELITEA_RUNTIME_ENABLED":                   "true",
		"ELITEA_RUNTIME_COMMAND_STREAM":            "commands.v1.configuration.validate.v1.validation-small.shared-credential-free.1.0",
		"ELITEA_RUNTIME_MAX_OUTSTANDING":           "128",
		"ELITEA_RUNTIME_STREAM_MAX_ENTRIES":        "256",
		"ELITEA_RUNTIME_REDIS_URL":                 "rediss://runtime@redis.internal:6379/0",
		"ELITEA_RUNTIME_REDIS_PASSWORD_FILE":       "/run/secrets/runtime-redis-password",
		"ELITEA_RUNTIME_REDIS_CA_FILE":             "/run/secrets/runtime-redis-ca.pem",
		"ELITEA_RUNTIME_REDIS_POOL_SIZE":           "8",
		"ELITEA_RUNTIME_SIGNING_KEY_ID":            "runtime-key-2026-01",
		"ELITEA_RUNTIME_SIGNING_KEY_FILE":          "/run/secrets/runtime-signing-key.pem",
		"ELITEA_RUNTIME_VERIFICATION_KEYRING_FILE": "/run/config/runtime-signing-keyring.json",
		"ELITEA_RUNTIME_CONTROL_ADDRESS":           ":9443",
		"ELITEA_RUNTIME_OUTPUT_ADDRESS":            ":9444",
		"ELITEA_RUNTIME_CONTENT_ADDRESS":           ":9445",
	}
	for _, prefix := range []string{"CONTROL", "OUTPUT", "CONTENT"} {
		values["ELITEA_RUNTIME_"+prefix+"_TLS_CERT_FILE"] = "/run/secrets/" + strings.ToLower(prefix) + "-server.pem"
		values["ELITEA_RUNTIME_"+prefix+"_TLS_KEY_FILE"] = "/run/secrets/" + strings.ToLower(prefix) + "-server-key.pem"
		values["ELITEA_RUNTIME_"+prefix+"_TLS_CLIENT_CA_FILE"] = "/run/secrets/" + strings.ToLower(prefix) + "-client-ca.pem"
	}
	return values
}
