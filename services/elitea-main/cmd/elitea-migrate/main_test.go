package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestValidateTenantProjectPreflightRejectsFleetBeforePartialMigration(t *testing.T) {
	projects := []tenantProjectPreflight{
		{id: 1, schemaExists: true},
		{id: 2, schemaExists: false},
		{id: 3, schemaExists: true},
	}
	if _, err := validateTenantProjectPreflight(projects); err == nil || !strings.Contains(err.Error(), "[2]") {
		t.Fatalf("preflight error = %v", err)
	}

	want := []int64{1, 3}
	got, err := validateTenantProjectPreflight([]tenantProjectPreflight{
		{id: 1, schemaExists: true},
		{id: 3, schemaExists: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("eligible projects = %v, want %v", got, want)
	}
}
