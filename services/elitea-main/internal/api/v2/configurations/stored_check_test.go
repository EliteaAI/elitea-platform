package configurations

// The DECISION half of the stored connection check (stored_check.go), with no
// database in the way.
//
// The route half — a real row, read out of a real tenant schema, with no
// request body at all — is in stored_check_postgres_integration_test.go. Both
// halves are needed and neither replaces the other: this file can prove what
// the checker RECEIVED, which is the property the whole route exists for, and
// the integration file can prove the row was read rather than the body.
//
// Every case here would pass against a handler that fabricated success, except
// the ones that assert on the fake's recording. That is deliberate: the fakes
// record, and the assertions read the recording, because "the check reported
// success" and "the check happened" are different facts and #319's lesson was
// exactly that.

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

/* ── fakes ─────────────────────────────────────────────────────────────── */

// recordingStoredResolver records the resolution it was asked for and returns
// the plaintext a real vault would.
type recordingStoredResolver struct {
	requests []StoredConfigurationResolution
	resolved map[string]any
	err      error
}

func (r *recordingStoredResolver) ResolveStoredConfiguration(
	_ context.Context,
	request StoredConfigurationResolution,
) (map[string]any, error) {
	r.requests = append(r.requests, request)
	if r.err != nil {
		return nil, r.err
	}
	return r.resolved, nil
}

// recordingChecker records the payload it was handed. The assertions read
// THIS, not the returned result: a handler that reported success without
// resolving would still return the canned result.
type recordingChecker struct {
	types  []string
	data   []map[string]any
	result ConnectionCheckResult
	err    error
}

func (c *recordingChecker) Check(
	_ context.Context,
	configType string,
	data map[string]any,
) (ConnectionCheckResult, error) {
	c.types = append(c.types, configType)
	c.data = append(c.data, data)
	return c.result, c.err
}

// storedCheckHandler builds the handler under test with the pinned catalogue
// the production one loads.
func storedCheckHandler(opts ...Option) *Handler {
	return NewHandler(nil, opts...)
}

// sealedCredentialRow is a SAVED open_ai credential exactly as the sealing
// change stores one: the api_key column holds a {{secret.NAME}} reference, not
// the key.
func sealedCredentialRow() storedConfigurationRow {
	author := 4964
	return storedConfigurationRow{
		id:         11,
		uuid:       "11111111-1111-4111-8111-111111111111",
		configType: "open_ai",
		data: map[string]any{
			"api_base": "https://api.openai.com/v1",
			"api_key":  "{{secret.7f3c9a2b4d5e6f708192a3b4c5d6e7f8}}",
		},
		authorID: &author,
	}
}

/* ── the discriminating property ───────────────────────────────────────── */

// The whole reason this route exists: a SAVED credential is checked without
// the client sending the secret, because the client does not have it.
//
// The assertion is on what the CHECKER received. A handler that passed the
// stored row's data straight through would hand the provider the literal
// "{{secret.…}}" template and report a working credential as rejected — which
// is a failure the user cannot distinguish from a wrong key, and the reason
// this file asserts on the plaintext rather than on the status code.
func TestAStoredSealedCredentialIsCheckedWithTheRedeemedSecret(t *testing.T) {
	resolver := &recordingStoredResolver{resolved: map[string]any{
		"api_base": "https://api.openai.com/v1",
		"api_key":  "sk-redeemed-from-the-vault",
	}}
	checker := &recordingChecker{result: ConnectionCheckResult{Success: true, Message: "Connection successful"}}
	handler := storedCheckHandler(
		WithStoredConfigurationResolver(resolver),
		WithConnectionChecker(checker),
	)

	result, status := handler.checkStoredRow(context.Background(), "7", sealedCredentialRow())

	if status != http.StatusOK || !result.Success {
		t.Fatalf("status = %d success = %v, want %d and true", status, result.Success, http.StatusOK)
	}
	if len(checker.data) != 1 {
		t.Fatalf("the checker was called %d times, want 1. A success reported without a provider "+
			"round trip is the defect this route must not reproduce.", len(checker.data))
	}
	if got := checker.data[0]["api_key"]; got != "sk-redeemed-from-the-vault" {
		t.Fatalf("the checker received api_key %v, want the redeemed value.\n"+
			"  The stored row holds a {{secret.NAME}} reference; passing it through asks the "+
			"provider to authenticate a template string.", got)
	}
	if checker.types[0] != "open_ai" {
		t.Fatalf("the checker was called for type %q, want the STORED type", checker.types[0])
	}

	// The resolver must be asked about the row as STORED, and against the
	// project in the path — not a project id read out of the row's own JSON.
	if len(resolver.requests) != 1 {
		t.Fatalf("the resolver was called %d times, want 1", len(resolver.requests))
	}
	request := resolver.requests[0]
	if request.ProjectID != 7 {
		t.Fatalf("resolved against project %d, want 7 (the {projectID} the schema was built from)",
			request.ProjectID)
	}
	if request.AuthorID == nil || *request.AuthorID != 4964 {
		t.Fatalf("resolved with author %v, want the row's author: a `private: true` reference "+
			"resolves against that user's personal project", request.AuthorID)
	}
	if request.Data["api_key"] != "{{secret.7f3c9a2b4d5e6f708192a3b4c5d6e7f8}}" {
		t.Fatalf("the resolver was handed %v, want the STORED reference", request.Data["api_key"])
	}
}

// A resolution that fails is a failure of this credential, not a success and
// not a provider verdict. The provider must not be dialled at all.
func TestAStoredCheckThatCannotResolveRefusesWithoutCallingTheProvider(t *testing.T) {
	resolver := &recordingStoredResolver{err: errors.New("the vault cannot redeem the reference")}
	checker := &recordingChecker{result: ConnectionCheckResult{Success: true, Message: "Connection successful"}}
	handler := storedCheckHandler(
		WithStoredConfigurationResolver(resolver),
		WithConnectionChecker(checker),
	)

	result, status := handler.checkStoredRow(context.Background(), "7", sealedCredentialRow())

	if status != http.StatusBadRequest || result.Success {
		t.Fatalf("status = %d success = %v, want %d and false", status, result.Success, http.StatusBadRequest)
	}
	if len(checker.data) != 0 {
		t.Fatalf("the provider was dialled %d times for a row that does not resolve, want 0", len(checker.data))
	}
	// The cause carries a vault error. It must not reach the browser.
	if strings.Contains(result.Message, "vault") {
		t.Fatalf("the message %q carries the dependency's own error text", result.Message)
	}
}

/* ── the honest refusals ───────────────────────────────────────────────── */

// A KNOWN type with no working check answers the message legacy's own registry
// produced, byte for byte.
//
// The expected string is written out here rather than taken from
// connectionCheckNotSupportedMessage: a test that calls the same function it
// measures agrees with any wording, including a wrong one. The type is chosen
// from the pinned catalogue at run time so that a type ADDED to
// checkableConnectionTypes does not silently turn this case into a check of
// nothing.
func TestAStoredCheckOfAnUncheckableTypeAnswersTheUnsavedCheckMessage(t *testing.T) {
	checker := &recordingChecker{result: ConnectionCheckResult{Success: true}}
	handler := storedCheckHandler(
		WithStoredConfigurationResolver(&recordingStoredResolver{resolved: map[string]any{}}),
		WithConnectionChecker(checker),
	)

	uncheckable := ""
	for _, entry := range handler.catalog.PinnedEntries() {
		if _, checkable := checkableConnectionTypes[entry.Type]; !checkable && entry.Type != "" {
			uncheckable = entry.Type
			break
		}
	}
	if uncheckable == "" {
		t.Fatal("the pinned catalogue describes no uncheckable type; this case measures nothing")
	}

	row := sealedCredentialRow()
	row.configType = uncheckable
	result, status := handler.checkStoredRow(context.Background(), "7", row)

	want := "Checking connection is not supported yet for configuration type " + uncheckable
	if result.Message != want {
		t.Fatalf("message = %q, want %q.\n"+
			"  A stored row and an unsaved payload of the same type must not disagree about "+
			"whether the platform can check it.", result.Message, want)
	}
	if status != http.StatusBadRequest || result.Success {
		t.Fatalf("status = %d success = %v, want %d and false", status, result.Success, http.StatusBadRequest)
	}
	if len(checker.data) != 0 {
		t.Fatalf("an uncheckable type reached the provider %d times, want 0", len(checker.data))
	}
}

// A type this build has never heard of is a 404, as it is on the unsaved
// route. The stored row can hold one: the type column is not validated against
// the catalogue on write.
func TestAStoredCheckOfAnUnknownTypeIsNotFound(t *testing.T) {
	handler := storedCheckHandler(
		WithStoredConfigurationResolver(&recordingStoredResolver{resolved: map[string]any{}}),
		WithConnectionChecker(&recordingChecker{}),
	)
	row := sealedCredentialRow()
	row.configType = "a_type_no_build_registers"

	result, status := handler.checkStoredRow(context.Background(), "7", row)

	if status != http.StatusNotFound || result.Success {
		t.Fatalf("status = %d success = %v, want %d and false", status, result.Success, http.StatusNotFound)
	}
}

/* ── the composition failures ──────────────────────────────────────────── */

// typedNilResolver is the shape that makes a nil test FALSE: a nil pointer
// boxed into a non-nil interface, which is what a composition root produces
// when it assigns the result of a constructor unconditionally.
//
// The handler's own nil test cannot catch it, by construction. What must hold
// is that the call still reaches a method that guards its receiver instead of
// dereferencing it — which the production resolver does, and
// runtimecomposition/configuration_stored_resolution_test.go measures on the
// production type (this package cannot import it: runtimecomposition imports
// this package).
type typedNilResolver struct{ _ int }

func (r *typedNilResolver) ResolveStoredConfiguration(
	context.Context,
	StoredConfigurationResolution,
) (map[string]any, error) {
	if r == nil {
		return nil, errors.New("resolver is not composed")
	}
	return map[string]any{}, nil
}

// A typed-nil resolver must cost the caller the ANSWER, not the process, and
// must not report success.
func TestAStoredCheckSurvivesATypedNilResolver(t *testing.T) {
	checker := &recordingChecker{result: ConnectionCheckResult{Success: true}}
	handler := storedCheckHandler(
		WithStoredConfigurationResolver((*typedNilResolver)(nil)),
		WithConnectionChecker(checker),
	)

	defer func() {
		if recovered := recover(); recovered != nil {
			t.Fatalf("the stored check panicked with %v on a typed-nil resolver", recovered)
		}
	}()
	result, status := handler.checkStoredRow(context.Background(), "7", sealedCredentialRow())
	if result.Success || status != http.StatusBadRequest {
		t.Fatalf("status = %d success = %v, want %d and false", status, result.Success, http.StatusBadRequest)
	}
	if len(checker.data) != 0 {
		t.Fatalf("the provider was dialled %d times with no working resolver, want 0", len(checker.data))
	}
}

// A build missing either dependency REFUSES, with the message the unsaved
// check already uses for the same condition — and it does not panic.
//
// Both directions matter. A missing resolver that fabricated success would
// tell a user a broken credential works. A missing resolver that panicked
// would take the process down from an authenticated route.
func TestAStoredCheckWithoutItsDependenciesRefusesAndDoesNotPanic(t *testing.T) {
	for name, handler := range map[string]*Handler{
		"nothing composed": storedCheckHandler(),
		"no resolver":      storedCheckHandler(WithConnectionChecker(&recordingChecker{result: ConnectionCheckResult{Success: true}})),
		"no checker":       storedCheckHandler(WithStoredConfigurationResolver(&recordingStoredResolver{resolved: map[string]any{}})),
	} {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if recovered := recover(); recovered != nil {
					t.Fatalf("the stored check panicked with %v. A dependency absent at the "+
						"composition root must cost the caller the answer, not the process.", recovered)
				}
			}()
			result, status := handler.checkStoredRow(context.Background(), "7", sealedCredentialRow())
			if result.Success {
				t.Fatal("a stored check reported success with a dependency missing")
			}
			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", status, http.StatusBadRequest)
			}
			if result.Message != storedConnectionCheckUnavailableMessage {
				t.Fatalf("message = %q, want the honest unavailable message %q",
					result.Message, storedConnectionCheckUnavailableMessage)
			}
		})
	}
}

// A project id outside the int32 the vault and the row columns hold is
// refused rather than truncated: a truncated id names ANOTHER project, whose
// vault would then redeem the secret.
func TestAStoredCheckRefusesAProjectIDOutsideTheColumn(t *testing.T) {
	checker := &recordingChecker{result: ConnectionCheckResult{Success: true}}
	handler := storedCheckHandler(
		WithStoredConfigurationResolver(&recordingStoredResolver{resolved: map[string]any{}}),
		WithConnectionChecker(checker),
	)

	result, status := handler.checkStoredRow(context.Background(), "4294967303", sealedCredentialRow())

	if result.Success || status != http.StatusBadRequest {
		t.Fatalf("status = %d success = %v, want %d and false", status, result.Success, http.StatusBadRequest)
	}
	if len(checker.data) != 0 {
		t.Fatalf("the provider was dialled %d times for an unusable project id, want 0", len(checker.data))
	}
}

/* ── the batch shapes ──────────────────────────────────────────────────── */

// The batch keys rows by either form the caller may address them with, and
// refuses anything that names no row at all.
func TestStoredConfigurationRowKeyAcceptsBothAddressForms(t *testing.T) {
	for name, testCase := range map[string]struct {
		requested any
		want      string
		ok        bool
	}{
		"integer id":    {requested: float64(11), want: "11", ok: true},
		"uuid":          {requested: "11111111-1111-4111-8111-111111111111", want: "11111111-1111-4111-8111-111111111111", ok: true},
		"fraction":      {requested: 1.5},
		"zero":          {requested: float64(0)},
		"negative":      {requested: float64(-3)},
		"above int32":   {requested: float64(1) + float64(1<<31)},
		"empty string":  {requested: ""},
		"boolean":       {requested: true},
		"object":        {requested: map[string]any{}},
		"null (as nil)": {requested: nil},
		"absurdly long": {requested: string(make([]byte, maxConfigurationFilterLength+1))},
	} {
		t.Run(name, func(t *testing.T) {
			got, ok := storedConfigurationRowKey(testCase.requested)
			if ok != testCase.ok {
				t.Fatalf("ok = %v, want %v", ok, testCase.ok)
			}
			if ok && got != testCase.want {
				t.Fatalf("key = %q, want %q", got, testCase.want)
			}
		})
	}
}
