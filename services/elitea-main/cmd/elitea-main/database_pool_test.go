package main

import "testing"

func TestDatabasePoolConfigPreservesPGXDefaultWithoutOverride(t *testing.T) {
	config, err := databasePoolConfig(
		"postgres://localhost:5432/elitea?sslmode=disable",
		func(string) (string, bool) { return "", false },
	)
	if err != nil {
		t.Fatal(err)
	}
	if config.MaxConns <= 0 {
		t.Fatalf("pgx default MaxConns = %d", config.MaxConns)
	}
}

func TestDatabasePoolConfigAppliesHybridBudget(t *testing.T) {
	config, err := databasePoolConfig(
		"postgres://localhost:5432/elitea?sslmode=disable",
		func(name string) (string, bool) {
			if name == databaseMaxConnectionsEnvironment {
				return "4", true
			}
			return "", false
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if config.MaxConns != 4 {
		t.Fatalf("MaxConns = %d, want 4", config.MaxConns)
	}
}

func TestDatabasePoolConfigRejectsInvalidBudget(t *testing.T) {
	for _, value := range []string{"0", "65", "01", "invalid"} {
		t.Run(value, func(t *testing.T) {
			_, err := databasePoolConfig(
				"postgres://localhost:5432/elitea?sslmode=disable",
				func(string) (string, bool) { return value, true },
			)
			if err == nil {
				t.Fatal("invalid pool budget was accepted")
			}
		})
	}
}
