// Package material carries the app-agnostic half of an invoke-body rewrite:
// the client sends REFERENCES, the provider receives MATERIAL (ADR-0022
// decision 6).
//
// It was DeepWiki's, and it is here because Inventory needs the same six
// mechanics and none of DeepWiki's field names:
//
//   - a BOUNDED read of the request body and the `configuration.parameters`
//     split, so a facade edits one map and re-encodes every sibling verbatim;
//   - the CALLBACK GRANT — mint before the hop, revoke when the hop refuses;
//   - the `llm_settings` block the engine reads for BOTH its model calls and
//     its artifact callbacks, and the TOOL-level lift that stops a client's
//     own block from replacing it (#727);
//   - the git-host EGRESS allowlist, checked before any vault is opened;
//   - the invoke HTTP handler that ties those together.
//
// WHAT IS NOT HERE, and stays with each facade: the field NAMES. DeepWiki
// expands `code_toolkit`; Inventory expands each id in its toolkit's
// `sources`. A "generic" rewriter that knew both names would be a switch on
// the provider, which is the shape ADR-0023's app registry replaced.
package material

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
)

// MaxBodyBytes caps what is parsed. The real payload is a handful of small
// fields; anything larger is a client sending something a facade has no
// business rewriting, and reading it into memory to find that out is the
// failure mode worth avoiding.
const MaxBodyBytes = 1 << 20

// ErrRejected reports a body the facade will not forward.
var ErrRejected = errors.New("provider invocation rejected")

// Envelope is one parsed invoke body, split at the two seams a rewrite needs.
//
// Every key it does not touch is held as json.RawMessage and re-encoded
// verbatim, which is what makes a facade a proxy rather than a re-serialiser:
// a field the provider's descriptor gains later travels through unchanged.
type Envelope struct {
	root          map[string]json.RawMessage
	configuration map[string]json.RawMessage
	parameters    map[string]json.RawMessage
}

// Read parses a bounded invoke body.
func Read(body io.Reader) (*Envelope, error) {
	raw, err := io.ReadAll(io.LimitReader(body, MaxBodyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrRejected, err)
	}
	if len(raw) > MaxBodyBytes {
		return nil, fmt.Errorf("%w: body exceeds %d bytes", ErrRejected, MaxBodyBytes)
	}
	root := map[string]json.RawMessage{}
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, fmt.Errorf("%w: body is not a JSON object", ErrRejected)
	}
	configuration := map[string]json.RawMessage{}
	if encoded, ok := root["configuration"]; ok && !IsNull(encoded) {
		if err := json.Unmarshal(encoded, &configuration); err != nil {
			return nil, fmt.Errorf("%w: configuration is not an object", ErrRejected)
		}
	}
	parameters := map[string]json.RawMessage{}
	if encoded, ok := configuration["parameters"]; ok && !IsNull(encoded) {
		if err := json.Unmarshal(encoded, &parameters); err != nil {
			return nil, fmt.Errorf("%w: configuration.parameters is not an object", ErrRejected)
		}
	}
	return &Envelope{root: root, configuration: configuration, parameters: parameters}, nil
}

// Parameters is `configuration.parameters`, the toolkit-level configuration a
// facade rewrites. The map is live: writing to it writes to the body.
func (e *Envelope) Parameters() map[string]json.RawMessage { return e.parameters }

// Configuration is the envelope around those parameters. Inventory reads
// `application_id` — the invoking toolkit's own row id — out of it.
func (e *Envelope) Configuration() map[string]json.RawMessage { return e.configuration }

// ToolParameters is the TOOL's own arguments, parsed fresh.
//
// Read-only, and a copy: the tool half of the body is forwarded verbatim
// except for the llm_settings lift, so handing out the live map would make an
// accidental write a silent change to a payload the client wrote correctly.
func (e *Envelope) ToolParameters() (map[string]json.RawMessage, error) {
	tool := map[string]json.RawMessage{}
	encoded, ok := e.root["parameters"]
	if !ok || IsNull(encoded) {
		return tool, nil
	}
	if err := json.Unmarshal(encoded, &tool); err != nil {
		return nil, fmt.Errorf("%w: parameters is not an object", ErrRejected)
	}
	return tool, nil
}

// Set replaces one toolkit-level parameter with an encoded value.
func (e *Envelope) Set(key string, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrRejected, err)
	}
	e.parameters[key] = encoded
	return nil
}

// Encode re-assembles the body to forward.
func (e *Envelope) Encode() ([]byte, error) {
	for _, step := range []struct {
		into map[string]json.RawMessage
		key  string
		from map[string]json.RawMessage
	}{
		{e.configuration, "parameters", e.parameters},
		{e.root, "configuration", e.configuration},
	} {
		encoded, err := json.Marshal(step.from)
		if err != nil {
			return nil, fmt.Errorf("%w: %s", ErrRejected, err)
		}
		step.into[step.key] = encoded
	}
	rewritten, err := json.Marshal(e.root)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrRejected, err)
	}
	return rewritten, nil
}

// String reads a trimmed string parameter, or "" for anything else.
func String(parameters map[string]json.RawMessage, key string) string {
	encoded, ok := parameters[key]
	if !ok {
		return ""
	}
	var value string
	if err := json.Unmarshal(encoded, &value); err != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

// FirstString reads the first of several keys that carries a non-empty string.
func FirstString(parameters map[string]json.RawMessage, keys ...string) string {
	for _, key := range keys {
		if value := String(parameters, key); value != "" {
			return value
		}
	}
	return ""
}

// RowID reads a positive row id a client named.
//
// A NUMBER, and only a number. A client sending an expanded object instead is
// a client pushing its own credentials — refused rather than merged, because
// merging would leave the caller in control of which token the provider uses.
func RowID(encoded json.RawMessage, field string) (int32, error) {
	if len(bytes.TrimSpace(encoded)) == 0 || IsNull(encoded) {
		return 0, fmt.Errorf("%w: %s is required", ErrRejected, field)
	}
	var id int32
	if err := json.Unmarshal(encoded, &id); err != nil {
		return 0, fmt.Errorf("%w: %s must be a row id, not %s",
			ErrRejected, field, Describe(encoded))
	}
	if id <= 0 {
		return 0, fmt.Errorf("%w: %s %d is not a row id", ErrRejected, field, id)
	}
	return id, nil
}

// NarrowRowID converts to the width the platform's id columns use, or refuses.
//
// Refusing rather than clamping: the columns are Postgres `integer`, so a
// value above MaxInt32 cannot name a row, and truncating would silently
// resolve a DIFFERENT project's credentials (CodeQL
// go/incorrect-integer-conversion).
func NarrowRowID(value int64) (int32, bool) {
	if value <= 0 || value > math.MaxInt32 {
		return 0, false
	}
	return int32(value), true
}

// IsNull reports a literal JSON null.
func IsNull(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) == 4 && bytes.Equal(trimmed, []byte("null"))
}

// Describe names a value's kind for an error message, without echoing the
// value: the thing a client wrongly put in a credential field is exactly the
// thing most likely to be a secret.
func Describe(raw json.RawMessage) string {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return "nothing"
	}
	switch trimmed[0] {
	case '{':
		return "an object"
	case '[':
		return "an array"
	case '"':
		return "a string"
	default:
		return "that value"
	}
}
