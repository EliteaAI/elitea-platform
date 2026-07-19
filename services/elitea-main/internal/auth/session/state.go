// Package session defines the server-side browser authentication state shared
// by identity providers and the HTTP authentication boundary.
package session

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"
)

const (
	CurrentSchemaVersion       = 1
	MaxErrorBytes              = 1 << 10
	MaxProviderBytes           = 128
	MaxProviderAttributesBytes = 32 << 10
)

var ErrInvalidState = errors.New("invalid browser session state")

// State is the language-neutral replacement for the current pylon_auth auth
// context persisted in the server-side session. ProviderAttributes is a JSON
// object so provider-specific claims remain at the authentication boundary
// instead of becoming untyped fields throughout the service. This preserves
// the current-baseline provider_attr object, including its nested sessionindex
// value.
type State struct {
	SchemaVersion      int             `json:"schema_version"`
	Done               bool            `json:"done"`
	Error              string          `json:"error"`
	Expiration         *time.Time      `json:"expiration"`
	Provider           *string         `json:"provider"`
	ProviderAttributes json.RawMessage `json:"provider_attr"`
	UserID             *int64          `json:"user_id"`
}

// Validate checks the fixed session schema and its allocation bounds. It does
// not decide whether Expiration has elapsed; the store owns that clock check.
func (s State) Validate() error {
	if s.SchemaVersion != CurrentSchemaVersion {
		return invalid("unsupported schema version")
	}
	if len(s.Error) > MaxErrorBytes || !utf8.ValidString(s.Error) {
		return invalid("error value is invalid")
	}
	if s.Provider != nil && (len(*s.Provider) > MaxProviderBytes || !utf8.ValidString(*s.Provider)) {
		return invalid("provider value is invalid")
	}
	if s.Expiration != nil && s.Expiration.IsZero() {
		return invalid("expiration is invalid")
	}
	if s.UserID != nil && *s.UserID <= 0 {
		return invalid("user ID is invalid")
	}
	if len(s.ProviderAttributes) == 0 || len(s.ProviderAttributes) > MaxProviderAttributesBytes ||
		!utf8.Valid(s.ProviderAttributes) {
		return invalid("provider attributes size is invalid")
	}
	var attributes map[string]json.RawMessage
	if err := json.Unmarshal(s.ProviderAttributes, &attributes); err != nil || attributes == nil {
		return invalid("provider attributes must be a JSON object")
	}
	return nil
}

func invalid(reason string) error {
	return fmt.Errorf("%w: %s", ErrInvalidState, reason)
}
