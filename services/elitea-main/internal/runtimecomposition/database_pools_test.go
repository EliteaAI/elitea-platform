package runtimecomposition

import (
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPhaseOneDatabasePoolLimitsArePositiveAndBounded(t *testing.T) {
	limits := PhaseOneDatabasePoolLimits()
	if err := limits.Validate(); err != nil {
		t.Fatal(err)
	}
	if limits.AdmissionPublisher != 10 || limits.Control != 8 || limits.Output != 8 ||
		limits.Replay != 4 || limits.TerminalEffects != 2 || limits.Content != 4 {
		t.Fatalf("unexpected phase-one database profile: %+v", limits)
	}
}

func TestRuntimeDependenciesRejectSharedDatabaseCapacity(t *testing.T) {
	shared := new(pgxpool.Pool)
	dependencies := Dependencies{
		AdmissionPool:       shared,
		ControlPool:         shared,
		OutputPool:          new(pgxpool.Pool),
		ReplayPool:          new(pgxpool.Pool),
		TerminalEffectsPool: new(pgxpool.Pool),
		ContentPool:         new(pgxpool.Pool),
		PermissionResolver:  &authorizationPermissionResolver{},
		Logger:              slog.Default(),
	}
	if err := validateDependencies(dependencies); err == nil {
		t.Fatal("shared admission/control database pool was accepted")
	}

	dependencies.ControlPool = new(pgxpool.Pool)
	if err := validateDependencies(dependencies); err != nil {
		t.Fatal(err)
	}

	dependencies.TerminalEffectsPool = dependencies.ReplayPool
	if err := validateDependencies(dependencies); err == nil {
		t.Fatal("shared replay/terminal-effects database pool was accepted")
	}
}
