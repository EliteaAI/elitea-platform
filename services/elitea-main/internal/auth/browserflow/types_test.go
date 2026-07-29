package browserflow

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestTransactionIDIsCanonical256BitBase64URL(t *testing.T) {
	t.Parallel()

	seen := make(map[string]struct{}, 64)
	for range 64 {
		id, err := NewTransactionID()
		if err != nil {
			t.Fatal(err)
		}
		if err := ValidateTransactionID(id); err != nil {
			t.Fatalf("generated transaction ID %q: %v", id, err)
		}
		if _, duplicate := seen[id]; duplicate {
			t.Fatalf("duplicate transaction ID %q", id)
		}
		seen[id] = struct{}{}
	}

	validRaw := make([]byte, TransactionIDRandomBytes)
	valid := base64.RawURLEncoding.EncodeToString(validRaw)
	invalid := []string{
		"",
		"transaction-1",
		valid + "=",
		base64.RawURLEncoding.EncodeToString(validRaw[:TransactionIDRandomBytes-1]),
		base64.RawURLEncoding.EncodeToString(append(validRaw, 0)),
		strings.Replace(valid, "A", "/", 1),
		valid[:len(valid)-1] + "B",
		" " + valid,
	}
	for _, id := range invalid {
		if err := ValidateTransactionID(id); !errors.Is(err, ErrInvalidValue) {
			t.Fatalf("invalid transaction ID %q error = %v, want %v", id, err, ErrInvalidValue)
		}
	}
}

func TestValidateReturnTargetKeepsRedirectLocalAndBounded(t *testing.T) {
	t.Parallel()

	for _, target := range []string{
		"/",
		"/projects/42",
		"/projects/42?tab=artifacts",
		"/path%20with%20spaces",
	} {
		if err := ValidateReturnTarget(target); err != nil {
			t.Fatalf("valid target %q: %v", target, err)
		}
	}

	for _, target := range []string{
		"",
		"projects/42",
		"https://attacker.example/",
		"//attacker.example/",
		`/\attacker.example`,
		"/path\nsecond-header",
		strings.Repeat("x", MaxReturnTargetBytes+1),
	} {
		if err := ValidateReturnTarget(target); !errors.Is(err, ErrInvalidValue) {
			t.Fatalf("invalid target %q error = %v, want %v", target, err, ErrInvalidValue)
		}
	}
}

func TestTransactionValidationAndActiveBoundary(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 20, 9, 0, 0, 0, time.UTC)
	valid := Transaction{
		SchemaVersion:        CurrentTransactionSchemaVersion,
		Provider:             "oidc",
		OriginatingSessionID: "session-1",
		ReturnTarget:         "/projects/7",
		CreatedAt:            now,
		ExpiresAt:            now.Add(5 * time.Minute),
		Correlation:          ProtocolCorrelation{Nonce: "nonce-1"},
		ProviderState:        ProviderState{PKCEVerifier: strings.Repeat("v", MinPKCEVerifierBytes)},
	}
	if err := valid.Validate(); err != nil {
		t.Fatal(err)
	}
	if !valid.ActiveAt(now) || !valid.ActiveAt(valid.ExpiresAt.Add(-time.Nanosecond)) {
		t.Fatal("transaction was inactive inside its validity interval")
	}
	if valid.ActiveAt(now.Add(-time.Nanosecond)) || valid.ActiveAt(valid.ExpiresAt) {
		t.Fatal("transaction was active outside its half-open validity interval")
	}

	tests := []struct {
		name   string
		mutate func(*Transaction)
	}{
		{name: "provider", mutate: func(tx *Transaction) { tx.Provider = "oidc other" }},
		{name: "schema", mutate: func(tx *Transaction) { tx.SchemaVersion++ }},
		{name: "session", mutate: func(tx *Transaction) { tx.OriginatingSessionID = "" }},
		{name: "target", mutate: func(tx *Transaction) { tx.ReturnTarget = "https://attacker.example" }},
		{name: "created", mutate: func(tx *Transaction) { tx.CreatedAt = time.Time{} }},
		{name: "created not UTC", mutate: func(tx *Transaction) { tx.CreatedAt = tx.CreatedAt.In(time.FixedZone("offset", 3600)) }},
		{name: "expires", mutate: func(tx *Transaction) { tx.ExpiresAt = tx.CreatedAt }},
		{name: "lifetime", mutate: func(tx *Transaction) { tx.ExpiresAt = tx.CreatedAt.Add(MaxTransactionLifetime + time.Nanosecond) }},
		{name: "correlation", mutate: func(tx *Transaction) { tx.Correlation.Nonce = "nonce with spaces" }},
		{name: "provider state", mutate: func(tx *Transaction) { tx.ProviderState.PKCEVerifier = "too-short" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			transaction := valid
			test.mutate(&transaction)
			if err := transaction.Validate(); !errors.Is(err, ErrInvalidValue) {
				t.Fatalf("error = %v, want %v", err, ErrInvalidValue)
			}
		})
	}
}

func TestTransactionJSONRoundTripPreservesBoundedUTCState(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.July, 20, 9, 0, 0, 0, time.UTC)
	want := Transaction{
		SchemaVersion:        CurrentTransactionSchemaVersion,
		Provider:             "oidc",
		OriginatingSessionID: "session-1",
		ReturnTarget:         "/projects/7",
		CreatedAt:            now,
		ExpiresAt:            now.Add(5 * time.Minute),
		Correlation:          ProtocolCorrelation{Nonce: "nonce-1"},
		ProviderState:        ProviderState{PKCEVerifier: strings.Repeat("v", MinPKCEVerifierBytes)},
	}
	encoded, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "PKCEVerifier") || !strings.Contains(string(encoded), `"schema_version":1`) {
		t.Fatalf("durable JSON keys = %s", encoded)
	}
	var got Transaction
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatal(err)
	}
	if err := got.Validate(); err != nil {
		t.Fatalf("round-tripped transaction: %v", err)
	}
	if got != want {
		t.Fatalf("round trip = %+v, want %+v", got, want)
	}
}

func TestVerifiedAssertionRejectsMalformedIdentityAndCorrelation(t *testing.T) {
	t.Parallel()

	expiresAt := time.Date(2026, time.July, 20, 10, 0, 0, 0, time.UTC)
	valid := VerifiedAssertion{
		Provider:            "saml",
		ProviderReference:   "subject-42",
		Email:               "user@example.test",
		GivenName:           "Ada",
		FamilyName:          "Lovelace",
		Name:                "Ada Lovelace",
		Expiration:          &expiresAt,
		ProtocolCorrelation: ProtocolCorrelation{RequestID: "request-1"},
	}
	if err := valid.Validate(); err != nil {
		t.Fatal(err)
	}

	invalidUTF8 := string([]byte{0xff})
	tests := []struct {
		name   string
		mutate func(*VerifiedAssertion)
	}{
		{name: "provider", mutate: func(a *VerifiedAssertion) { a.Provider = "" }},
		{name: "provider whitespace", mutate: func(a *VerifiedAssertion) { a.Provider = "oidc provider" }},
		{name: "reference", mutate: func(a *VerifiedAssertion) { a.ProviderReference = "\t" }},
		{name: "reference control", mutate: func(a *VerifiedAssertion) { a.ProviderReference = "subject\nother" }},
		{name: "email whitespace", mutate: func(a *VerifiedAssertion) { a.Email = "user @example.test" }},
		{name: "name encoding", mutate: func(a *VerifiedAssertion) { a.Name = invalidUTF8 }},
		{name: "correlation size", mutate: func(a *VerifiedAssertion) {
			a.ProtocolCorrelation.Nonce = strings.Repeat("n", MaxCorrelationValueBytes+1)
		}},
		{name: "expiration", mutate: func(a *VerifiedAssertion) { zero := time.Time{}; a.Expiration = &zero }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assertion := valid
			test.mutate(&assertion)
			if err := assertion.Validate(); !errors.Is(err, ErrInvalidValue) {
				t.Fatalf("error = %v, want %v", err, ErrInvalidValue)
			}
		})
	}
}
