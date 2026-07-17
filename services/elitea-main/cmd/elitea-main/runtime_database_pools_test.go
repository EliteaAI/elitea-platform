package main

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/runtimecomposition"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRuntimeDatabasePoolsUseIsolatedBoundedRoleProfileAndCloseOnce(t *testing.T) {
	var specs []runtimePoolSpec
	var closed []string
	factory := func(_ context.Context, dsn string, spec runtimePoolSpec) (runtimePoolResource, error) {
		if dsn != "postgres://runtime-test" {
			t.Fatalf("unexpected DSN passed to factory")
		}
		specs = append(specs, spec)
		return runtimePoolResource{
			pool: new(pgxpool.Pool),
			close: func() {
				closed = append(closed, spec.role)
			},
		}, nil
	}
	pools, err := openRuntimeDatabasePoolsWithFactory(context.Background(), "postgres://runtime-test", runtimecomposition.PhaseOneDatabasePoolLimits(), factory)
	if err != nil {
		t.Fatal(err)
	}
	if pools.Admission == pools.Control || pools.Admission == pools.Output || pools.Admission == pools.Replay || pools.Admission == pools.Content || pools.Control == pools.Output || pools.Control == pools.Replay || pools.Control == pools.Content || pools.Output == pools.Replay || pools.Output == pools.Content || pools.Replay == pools.Content {
		t.Fatal("runtime database roles share a pool")
	}
	wantSpecs := []runtimePoolSpec{
		{role: "admission-publisher", maxConns: 10},
		{role: "control", maxConns: 8},
		{role: "output", maxConns: 8},
		{role: "sse-replay", maxConns: 4},
		{role: "content", maxConns: 4},
	}
	if !reflect.DeepEqual(specs, wantSpecs) {
		t.Fatalf("pool specs = %+v, want %+v", specs, wantSpecs)
	}
	pools.Close()
	pools.Close()
	if want := []string{"content", "sse-replay", "output", "control", "admission-publisher"}; !reflect.DeepEqual(closed, want) {
		t.Fatalf("closed roles = %v, want %v", closed, want)
	}
}

func TestRuntimeDatabasePoolConstructionClosesPartialOwnership(t *testing.T) {
	want := errors.New("output pool unavailable")
	var closed []string
	factory := func(_ context.Context, _ string, spec runtimePoolSpec) (runtimePoolResource, error) {
		if spec.role == "output" {
			return runtimePoolResource{}, want
		}
		return runtimePoolResource{
			pool:  new(pgxpool.Pool),
			close: func() { closed = append(closed, spec.role) },
		}, nil
	}
	_, err := openRuntimeDatabasePoolsWithFactory(context.Background(), "postgres://runtime-test", runtimecomposition.PhaseOneDatabasePoolLimits(), factory)
	if !errors.Is(err, want) {
		t.Fatalf("construction error = %v, want %v", err, want)
	}
	if wantClosed := []string{"control", "admission-publisher"}; !reflect.DeepEqual(closed, wantClosed) {
		t.Fatalf("partial resources closed = %v, want %v", closed, wantClosed)
	}
}
