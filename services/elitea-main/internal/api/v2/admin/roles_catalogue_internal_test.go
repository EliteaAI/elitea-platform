package admin

// The permission catalogue behind the admin Roles matrix.
//
// DEFECT. permissionCatalogue read the matrix rows back out of the grants:
// `SELECT permission FROM auth_core__role_permission UNION SELECT permission
// FROM auth_core__project_role_permission`. A permission that no role holds is
// then not a row, and parseMatrixBody rejects it with "unknown permission", so
// no API path can grant it. Two shapes follow.
//
//   - `configuration.advanced` and `configuration.service_descriptors` gate two
//     admin Configuration sections (config_schemas.go, enforced by
//     config_values.go). No migration seeds either one, so both were
//     ungrantable from the first boot.
//   - Revocation was irreversible. `configuration.governance` is seeded by one
//     migration only (shared/0082). An operator who unchecks its last holder
//     deletes the row the catalogue came from, and the name can never be
//     granted again.
//
// EVIDENCE. Pylon does not have this failure: `auth.local_permissions` is a
// declaration registry, so both names are matrix rows there.

import (
	"encoding/json"
	"testing"
)

// TestDeclaredPermissionsHoldEveryConfigSectionGate keeps the declaration in
// step with the sections. A section that carries `required_permission` refuses
// itself to a caller who does not hold that name, so the name must be
// grantable.
func TestDeclaredPermissionsHoldEveryConfigSectionGate(t *testing.T) {
	declared := make(map[string]bool)
	for _, name := range declaredPermissions() {
		declared[name] = true
	}
	if len(declared) == 0 {
		t.Fatal("declaredPermissions() is empty; the section list or its key changed")
	}

	for _, section := range configSections() {
		permission, ok := section["required_permission"].(string)
		if !ok || permission == "" {
			continue
		}
		if !declared[permission] {
			t.Errorf("section %v gates on %q, which declaredPermissions() omits",
				section["id"], permission)
		}
	}
	for _, want := range []string{"configuration.advanced", "configuration.service_descriptors"} {
		if !declared[want] {
			t.Errorf("declaredPermissions() omits %q, which no migration grants", want)
		}
	}
}

// TestPermissionCatalogueKeepsDeclaredNamesWithoutAGrant is the read half: on a
// clean database no role holds either name, and the matrix must still show the
// row.
func TestPermissionCatalogueKeepsDeclaredNamesWithoutAGrant(t *testing.T) {
	catalogue := catalogueFrom(nil)
	present := make(map[string]bool, len(catalogue))
	for _, name := range catalogue {
		present[name] = true
	}
	for _, want := range []string{"configuration.advanced", "configuration.service_descriptors"} {
		if !present[want] {
			t.Errorf("catalogue built from zero grants omits %q", want)
		}
	}

	sorted := mergePermissionCatalogue([]string{"b.two", "a.one", "b.two"}, []string{"a.one", "c.three"})
	want := []string{"a.one", "b.two", "c.three"}
	if len(sorted) != len(want) {
		t.Fatalf("merged catalogue = %v, want %v", sorted, want)
	}
	for index, name := range want {
		if sorted[index] != name {
			t.Fatalf("merged catalogue = %v, want %v", sorted, want)
		}
	}
}

// TestMatrixSaveAcceptsADeclaredPermissionNobodyHolds is the write half. It is
// the failure the operator meets: the PUT that grants the permission was
// refused 400 because the catalogue did not carry the name.
func TestMatrixSaveAcceptsADeclaredPermissionNobodyHolds(t *testing.T) {
	current := permissionMatrix{
		roles:     []string{"admin"},
		catalogue: catalogueFrom(nil),
	}
	body := []map[string]json.RawMessage{{
		"name":  json.RawMessage(`"configuration.service_descriptors"`),
		"admin": json.RawMessage(`true`),
	}}

	submission, err := parseMatrixBody(body, current)
	if err != nil {
		t.Fatalf("granting a declared permission was refused: %v", err)
	}
	if !submission.rows["configuration.service_descriptors"] {
		t.Fatal("the submitted row was dropped")
	}
	if !submission.desired[grant{role: "admin", permission: "configuration.service_descriptors"}] {
		t.Fatalf("the grant was not recorded: %+v", submission.desired)
	}
}
