package main

import "testing"

func TestRedisOptionsFromEnv(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		values       map[string]string
		wantAddress  string
		wantUsername string
		wantPassword string
		wantTLS      bool
		wantErr      bool
	}{
		{
			name:        "default address",
			wantAddress: defaultRedisAddress,
		},
		{
			name: "current centry host and password",
			values: map[string]string{
				"REDIS_URL":      "redis:6379",
				"REDIS_PASSWORD": "current-secret",
			},
			wantAddress:  "redis:6379",
			wantPassword: "current-secret",
		},
		{
			name: "URL credentials",
			values: map[string]string{
				"REDIS_URL": "redis://worker:url-secret@redis:6380/2",
			},
			wantAddress:  "redis:6380",
			wantUsername: "worker",
			wantPassword: "url-secret",
		},
		{
			name: "separate credentials override URL credentials",
			values: map[string]string{
				"REDIS_URL":      "rediss://old:old-secret@redis:6380/0",
				"REDIS_USERNAME": "current",
				"REDIS_PASSWORD": "current-secret",
			},
			wantAddress:  "redis:6380",
			wantUsername: "current",
			wantPassword: "current-secret",
			wantTLS:      true,
		},
		{
			name:    "invalid URL",
			values:  map[string]string{"REDIS_URL": "redis://%"},
			wantErr: true,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			options, err := redisOptionsFromEnv(func(key string) (string, bool) {
				value, present := test.values[key]
				return value, present
			})
			if test.wantErr {
				if err == nil {
					t.Fatal("expected configuration error")
				}
				return
			}
			if err != nil {
				t.Fatalf("redisOptionsFromEnv() error = %v", err)
			}
			if options.Addr != test.wantAddress {
				t.Fatalf("Addr = %q, want %q", options.Addr, test.wantAddress)
			}
			if options.Username != test.wantUsername {
				t.Fatalf("Username = %q, want %q", options.Username, test.wantUsername)
			}
			if options.Password != test.wantPassword {
				t.Fatalf("Password = %q, want %q", options.Password, test.wantPassword)
			}
			if (options.TLSConfig != nil) != test.wantTLS {
				t.Fatalf("TLS configured = %t, want %t", options.TLSConfig != nil, test.wantTLS)
			}
		})
	}
}

func TestRedisOptionsFromEnvRejectsMissingLookup(t *testing.T) {
	t.Parallel()

	if _, err := redisOptionsFromEnv(nil); err == nil {
		t.Fatal("expected missing lookup error")
	}
}
