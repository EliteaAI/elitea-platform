package secrets

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

// One idiom for "not found", and three answers a caller can still tell apart
// (#416).
//
// The package used to hold two idioms: LookupProjectSecret returned a
// `found bool`, everything else returned the ErrSecretNotFound sentinel. A
// caller had to know which function it held before it could tell "absent" from
// "failed", and that is how an unreadable vault becomes an accepted default —
// the class #412 and #399 both belong to.
//
// These are pure assertions on the contract. The behaviour of a real vault read
// is proved against PostgreSQL in provisioner_vault_key_postgres_integration_test.go,
// and at the one production caller in
// internal/runtimecomposition/project_vault_not_found_idiom_test.go.

// The bool cannot come back without this failing. A signature assertion, not a
// grep, because a `(string, bool, error)` reintroduced on any exported lookup
// compiles and passes every behavioural test the package has.
func TestExportedLookupsReturnNoFoundBool(t *testing.T) {
	t.Parallel()

	handler := reflect.TypeOf(&Handler{})
	for i := range handler.NumMethod() {
		method := handler.Method(i)
		if !strings.HasPrefix(method.Name, "Lookup") && !strings.HasPrefix(method.Name, "Resolve") {
			continue
		}
		signature := method.Type
		for result := range signature.NumOut() {
			if signature.Out(result).Kind() == reflect.Bool {
				t.Fatalf("%s returns a bool. This package reports \"not found\" with "+
					"ErrSecretNotFound only, so a caller never has to know which "+
					"function it holds (#416)", method.Name)
			}
		}
	}
}

// The three conditions stay separable after any amount of wrapping, and none of
// them answers for another.
func TestNotFoundAndUnreadableAndAbsentVaultAreDistinct(t *testing.T) {
	t.Parallel()

	absentSecret := fmt.Errorf("look up p_7 secret: %w: %q", ErrSecretNotFound, "OPENAI_API_KEY")
	absentVault := fmt.Errorf("look up p_7 secret: %w", ErrVaultAbsent)
	// The message names the missing secret on purpose: a caller that matched on
	// text rather than on the sentinel would read this failure as an absent
	// secret and apply a default over material it simply could not open.
	readFailed := errors.New("look up p_7 secret: decrypt p_7 vault key: secret not found in cipher")

	if !errors.Is(absentSecret, ErrSecretNotFound) {
		t.Fatal("a wrapped ErrSecretNotFound stopped matching errors.Is")
	}
	if errors.Is(absentSecret, ErrVaultAbsent) {
		t.Fatal("an absent secret matched ErrVaultAbsent: the project would be reported as unprovisioned")
	}
	if !errors.Is(absentVault, ErrVaultAbsent) {
		t.Fatal("a wrapped ErrVaultAbsent stopped matching errors.Is")
	}
	if errors.Is(absentVault, ErrSecretNotFound) {
		t.Fatal("a project with no vault matched ErrSecretNotFound: provisioning that never ran would read as one empty secret")
	}
	if errors.Is(readFailed, ErrSecretNotFound) || errors.Is(readFailed, ErrVaultAbsent) {
		t.Fatalf("a read failure matched a not-found sentinel: %v", readFailed)
	}
}
