package migrate

import (
	"reflect"
	"strings"
	"testing"
)

func TestValidateTenantProjectsRejectsFleetBeforePartialMigration(t *testing.T) {
	projects := []TenantProject{
		{ID: 1, SchemaExists: true},
		{ID: 2, SchemaExists: false},
		{ID: 3, SchemaExists: true},
	}
	if _, err := validateTenantProjects(projects); err == nil || !strings.Contains(err.Error(), "[2]") {
		t.Fatalf("preflight error = %v", err)
	}

	want := []int64{1, 3}
	got, err := validateTenantProjects([]TenantProject{
		{ID: 1, SchemaExists: true},
		{ID: 3, SchemaExists: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("eligible projects = %v, want %v", got, want)
	}
}
