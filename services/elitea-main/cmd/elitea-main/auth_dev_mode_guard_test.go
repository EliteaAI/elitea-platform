package main

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
)

// The AUTH_DEV_MODE bypass is deleted (ADR-0017, #260). Deleting a feature
// leaves no failing test behind, so these pin the startup guard that keeps a
// stale manifest from being silently ignored: an operator who still sets
// AUTH_DEV_MODE=true believes authentication is disabled and may have deployed
// on that assumption. Refusing to start is the only safe answer.
//
// The middleware half — that the variable cannot inject a principal even if
// the process does start — lives in
// internal/api.TestProductionRuntimeRoutesRejectDevelopmentFallback.

func TestRunRefusesToStartWhenAuthDevModeIsTrue(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "true")

	err := run(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err == nil {
		t.Fatal("run() returned nil: the service started with AUTH_DEV_MODE=true")
	}
	if !strings.Contains(err.Error(), "AUTH_DEV_MODE=true is no longer supported") {
		t.Fatalf("error = %q, want the ADR-0017 removal message", err)
	}
}

// A lingering "false" is inert and must stay tolerated — deployments that
// pinned it off should not be broken by the removal. This asserts only that
// the AUTH_DEV_MODE guard does not fire; run() still fails later for unrelated
// reasons (no database), which is why the check is on the message.
func TestRunToleratesAuthDevModeFalse(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "false")

	err := run(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil && strings.Contains(err.Error(), "AUTH_DEV_MODE") {
		t.Fatalf("AUTH_DEV_MODE=false was rejected: %v", err)
	}
}

// The legacy-schema bootstrap no longer cross-checks AUTH_DEV_MODE; it is
// self-gating instead. It must refuse to run on anything that has a real
// authentication mode configured.
func TestRunRefusesLegacyBootstrapWhenAuthenticationIsConfigured(t *testing.T) {
	for _, configured := range []string{"APPLICATION_SECRET_KEY", "OIDC_ISSUER_URL", "ELITEA_AUTH_CONFIG_FILE"} {
		t.Run(configured, func(t *testing.T) {
			t.Setenv("ELITEA_DEV_BOOTSTRAP_LEGACY_SCHEMA", "true")
			t.Setenv(configured, "set-to-something")

			err := run(context.Background(), slog.New(slog.NewTextHandler(io.Discard, nil)))
			if err == nil || !strings.Contains(err.Error(), "ELITEA_DEV_BOOTSTRAP_LEGACY_SCHEMA") {
				t.Fatalf("error = %v, want a refusal naming ELITEA_DEV_BOOTSTRAP_LEGACY_SCHEMA", err)
			}
		})
	}
}
