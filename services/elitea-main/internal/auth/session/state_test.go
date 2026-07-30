package session

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestStateValidateSupportsIncompleteAndCompletedCurrentBaselineStates(t *testing.T) {
	t.Parallel()

	incomplete := State{
		SchemaVersion:      CurrentSchemaVersion,
		ProviderAttributes: json.RawMessage("{}"),
	}
	if err := incomplete.Validate(); err != nil {
		t.Fatalf("incomplete state: %v", err)
	}

	userID := int64(42)
	provider := "oidc"
	expiration := time.Date(2026, time.July, 19, 12, 0, 0, 0, time.UTC)
	completed := State{
		SchemaVersion:      CurrentSchemaVersion,
		Done:               true,
		Expiration:         &expiration,
		Provider:           &provider,
		ProviderAttributes: json.RawMessage(`{"nameid":"subject-42","sessionindex":"provider-session-index"}`),
		UserID:             &userID,
	}
	if err := completed.Validate(); err != nil {
		t.Fatalf("completed state: %v", err)
	}

	// The current baseline permits an authenticated provider identity before a
	// local user mapping exists. Authorization decides whether that is usable.
	completed.UserID = nil
	if err := completed.Validate(); err != nil {
		t.Fatalf("completed state without mapped user: %v", err)
	}
}

func TestStateJSONUsesCurrentBaselineAuthContextNames(t *testing.T) {
	t.Parallel()

	record, err := json.Marshal(State{
		SchemaVersion:      CurrentSchemaVersion,
		ProviderAttributes: json.RawMessage(`{"sessionindex":"opaque-provider-session"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(record, &fields); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"schema_version",
		"done",
		"error",
		"expiration",
		"provider",
		"provider_attr",
		"user_id",
	}
	if len(fields) != len(want) {
		t.Fatalf("JSON fields = %v, want exactly %v", fields, want)
	}
	for _, name := range want {
		if _, ok := fields[name]; !ok {
			t.Fatalf("JSON field %q is missing: %s", name, record)
		}
	}
	if got := string(fields["provider"]); got != "null" {
		t.Fatalf("unset provider = %s, want null current-baseline value", got)
	}
}

func TestStateValidateRejectsInvalidOrUnboundedState(t *testing.T) {
	t.Parallel()

	userID := int64(42)
	provider := "oidc"
	base := State{
		SchemaVersion:      CurrentSchemaVersion,
		Done:               true,
		Provider:           &provider,
		ProviderAttributes: json.RawMessage("{}"),
		UserID:             &userID,
	}
	tests := map[string]func(State) State{
		"unknown schema": func(state State) State {
			state.SchemaVersion++
			return state
		},
		"non-positive user": func(state State) State {
			invalid := int64(0)
			state.UserID = &invalid
			return state
		},
		"non-object attributes": func(state State) State {
			state.ProviderAttributes = json.RawMessage("[]")
			return state
		},
		"duplicate identity at root": func(state State) State {
			state.ProviderAttributes = json.RawMessage(`{"nameid":"first","nameid":"second"}`)
			return state
		},
		"duplicate nested email claim": func(state State) State {
			state.ProviderAttributes = json.RawMessage(`{"attributes":{"email":"first@example.com","email":"second@example.com"}}`)
			return state
		},
		"duplicate identity inside array": func(state State) State {
			state.ProviderAttributes = json.RawMessage(`{"claims":[{"sessionindex":"first","sessionindex":"second"}]}`)
			return state
		},
		"invalid UTF-8 attributes": func(state State) State {
			state.ProviderAttributes = json.RawMessage{'{', '"', 'x', '"', ':', '"', 0xff, '"', '}'}
			return state
		},
		"oversized attributes": func(state State) State {
			state.ProviderAttributes = json.RawMessage(
				`{"value":"` + strings.Repeat("x", MaxProviderAttributesBytes) + `"}`,
			)
			return state
		},
		"oversized provider": func(state State) State {
			provider := strings.Repeat("x", MaxProviderBytes+1)
			state.Provider = &provider
			return state
		},
		"oversized error": func(state State) State {
			state.Error = strings.Repeat("x", MaxErrorBytes+1)
			return state
		},
	}

	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if err := mutate(base).Validate(); !errors.Is(err, ErrInvalidState) {
				t.Fatalf("error = %v, want %v", err, ErrInvalidState)
			}
		})
	}
}

func TestStateValidateAllowsSameMemberNameInDistinctObjects(t *testing.T) {
	t.Parallel()

	state := State{
		SchemaVersion: CurrentSchemaVersion,
		ProviderAttributes: json.RawMessage(
			`{"primary":{"email":"first@example.com"},"secondary":{"email":"second@example.com"}}`,
		),
	}
	if err := state.Validate(); err != nil {
		t.Fatalf("valid distinct object members: %v", err)
	}
}
