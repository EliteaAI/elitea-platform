// Package contextsettings holds the conversation context-management contract:
// the per-conversation strategy, the user-level defaults it falls back to, and
// the status document a reader serves.
//
// WHY A DOMAIN PACKAGE. The same shape is written in two unrelated places —
// `PUT /social/author` (the user's defaults, centry.social_users) and
// `PUT /elitea_core/context_strategy/...` (one conversation, its
// `meta.context_strategy`) — and read by a third (the context status). pylon
// had the same duplication and kept the two halves agreed only by convention:
// social/models/pd/users.py declared the defaults, elitea_core/models/pd/
// context.py declared the strategy, and elitea_core/utils/context_analytics.py
// `set_context_strategy` mapped one onto the other by hand. Defaults spelled
// twice are defaults that drift, so every constant, range and mapping rule
// lives here once.
//
// WHAT THE RUNTIME ACTUALLY HONOURS. This package persists and serves the
// contract; it does not execute it, and the two are not the same surface. The
// Rust runtime honours `max_context_tokens` as the budget,
// `preserve_recent_messages` as an untouchable tail, `preserve_system_messages`
// and `enable_summarization`. It fails CLOSED on the rest, so nothing here
// should be presented to a user as working:
//
//   - `enable_context_editing: true` has no ADK-Rust 2.0.0 equivalent and is
//     refused outright.
//   - a non-null `summary_llm_settings` names a second model whose credential
//     the execution claim does not carry, and is refused rather than quietly
//     falling back to the main model — which is why an empty block must
//     serialize as `null`; see normalizeSummaryLLMSettings.
//   - pipeline-graph executions are not covered at all: one model per node
//     means there is no transcript-wide summarizer to configure.
//
// Separately, elitea-main does not SEND any of this to the worker yet — every
// execution payload still carries `context_settings: {}`, pinned by
// internal/application/agentexecution's TestContextSettingsStayEmptyForTheWorker.
//
// PARITY. Field names, defaults and ranges are pylon's, verbatim:
//   - legacy/plugins/elitea_core/models/pd/context.py  (ContextStrategy,
//     ContextStrategyUpdate and its cross-field summary-token validator)
//   - legacy/plugins/social/models/pd/users.py         (ContextManagementModel,
//     SummarizationModel)
//   - legacy/plugins/elitea_core/utils/context_analytics.py
//     (set_context_strategy — the defaults-to-strategy mapping)
package contextsettings

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
)

// The frozen contract's defaults. pylon: ContextStrategy's field defaults.
const (
	DefaultStrategyName           = "default"
	DefaultEnabled                = true
	DefaultEnableSummarization    = true
	DefaultEnableContextEditing   = false
	DefaultMaxContextTokens       = 64000
	DefaultPreserveRecentMessages = 5
	DefaultPreserveSystemMessages = true
	DefaultSummaryInstructions    = "Generate a concise summary of the following conversation messages"
)

// The frozen contract's ranges. pylon: the `Field(..., ge=, le=)` constraints
// on ContextStrategy/ContextStrategyUpdate, plus the model validator that
// bounds the summary model's own max_tokens.
const (
	MinMaxContextTokens       = 1000
	MinPreserveRecentMessages = 1
	MaxPreserveRecentMessages = 99
	MinSummaryMaxTokens       = 100
)

// FieldError names the offending field, so a handler can answer with this
// API's `{"error": ..., "field": ...}` validation shape (the same one
// internal/api/v2/configurations/mutation.go writes).
type FieldError struct {
	Field   string
	Message string
}

func (e *FieldError) Error() string { return e.Message }

func fieldErrorf(field, format string, args ...any) *FieldError {
	return &FieldError{Field: field, Message: fmt.Sprintf(format, args...)}
}

// Strategy is one conversation's resolved context-management configuration —
// the document stored at `chat_conversations.meta.context_strategy`.
//
// Every field is non-pointer on purpose: this is the RESOLVED value, the
// answer to "what applies to this conversation", so there is no such thing as
// an absent field here. Absence lives in StrategyUpdate and in the user
// defaults, both of which resolve INTO this.
type Strategy struct {
	Name                   string         `json:"name"`
	Enabled                bool           `json:"enabled"`
	EnableSummarization    bool           `json:"enable_summarization"`
	EnableContextEditing   bool           `json:"enable_context_editing"`
	MaxContextTokens       int            `json:"max_context_tokens"`
	PreserveRecentMessages int            `json:"preserve_recent_messages"`
	PreserveSystemMessages bool           `json:"preserve_system_messages"`
	SummaryInstructions    string         `json:"summary_instructions"`
	SummaryLLMSettings     map[string]any `json:"summary_llm_settings"`
}

// DefaultStrategy is the contract's constants — the last fallback of the
// resolution rule, used when neither the conversation nor the user says
// anything.
func DefaultStrategy() Strategy {
	return Strategy{
		Name:                   DefaultStrategyName,
		Enabled:                DefaultEnabled,
		EnableSummarization:    DefaultEnableSummarization,
		EnableContextEditing:   DefaultEnableContextEditing,
		MaxContextTokens:       DefaultMaxContextTokens,
		PreserveRecentMessages: DefaultPreserveRecentMessages,
		PreserveSystemMessages: DefaultPreserveSystemMessages,
		SummaryInstructions:    DefaultSummaryInstructions,
		SummaryLLMSettings:     nil,
	}
}

// normalizeSummaryLLMSettings collapses an EMPTY summary-model block to nil,
// so it serializes as `null` and never as `{}`.
//
// THIS IS LOAD-BEARING, NOT TIDINESS. The contract says
// `summary_llm_settings: object | null`, and the Rust runtime reads that
// literally: a non-null value names a SECOND model, which needs a credential
// resolution the execution claim does not carry, so the runtime refuses it
// with UnsupportedCapability rather than quietly falling back to the main
// model. `{}` is an object. An empty map — which is exactly what
// `encoding/json` produces from `"summary_llm_settings": {}` in a request
// body, and what a non-nil empty map field marshals back to — would therefore
// fail EVERY context-managed turn once both halves are enabled, for a value
// that says nothing at all.
//
// "No summary model" has one representation here, and it is nil.
func (s *Strategy) normalizeSummaryLLMSettings() {
	if len(s.SummaryLLMSettings) == 0 {
		s.SummaryLLMSettings = nil
	}
}

// Validate range-checks a resolved strategy. It is the same check the update
// path runs, applied to the merged result, so a stored document that predates
// a range can never be served as if it were valid.
func (s Strategy) Validate() *FieldError {
	if s.MaxContextTokens < MinMaxContextTokens {
		return fieldErrorf("max_context_tokens", "max_context_tokens must be at least %d", MinMaxContextTokens)
	}
	if s.PreserveRecentMessages < MinPreserveRecentMessages || s.PreserveRecentMessages > MaxPreserveRecentMessages {
		return fieldErrorf("preserve_recent_messages",
			"preserve_recent_messages must be between %d and %d",
			MinPreserveRecentMessages, MaxPreserveRecentMessages)
	}
	return validateSummaryMaxTokens(s.SummaryLLMSettings, s.MaxContextTokens)
}

// validateSummaryMaxTokens is pylon's `validate_summary_max_tokens` model
// validator: the summary model's own budget has to be a usable size AND has to
// fit inside the context it is summarizing. A summary allowed to be as large
// as the window it frees cannot free anything.
func validateSummaryMaxTokens(settings map[string]any, maxContextTokens int) *FieldError {
	if settings == nil {
		return nil
	}
	raw, present := settings["max_tokens"]
	if !present || raw == nil {
		return nil
	}
	maxTokens, ok := numeric(raw)
	if !ok {
		return fieldErrorf("summary_llm_settings.max_tokens", "summary_llm_settings.max_tokens must be a whole number")
	}
	if maxTokens < MinSummaryMaxTokens {
		return fieldErrorf("summary_llm_settings.max_tokens",
			"summary max tokens (%d) must be at least %d", maxTokens, MinSummaryMaxTokens)
	}
	if maxTokens >= maxContextTokens {
		return fieldErrorf("summary_llm_settings.max_tokens",
			"summary max tokens (%d) must be less than max context tokens (%d)", maxTokens, maxContextTokens)
	}
	return nil
}

// numeric reads a JSON number out of a decoded `any`, refusing a fractional
// value where the contract says integer.
func numeric(value any) (int, bool) {
	switch typed := value.(type) {
	case float64:
		if typed != math.Trunc(typed) {
			return 0, false
		}
		return int(typed), true
	case int:
		return typed, true
	case json.Number:
		parsed, err := typed.Int64()
		if err != nil {
			return 0, false
		}
		return int(parsed), true
	}
	return 0, false
}

// StrategyUpdate is the per-conversation PUT body: pylon's
// ContextStrategyUpdate. Every field is optional; an absent field keeps
// whatever the resolution rule already produced.
type StrategyUpdate struct {
	Name                   *string        `json:"name,omitempty"`
	Enabled                *bool          `json:"enabled,omitempty"`
	EnableSummarization    *bool          `json:"enable_summarization,omitempty"`
	EnableContextEditing   *bool          `json:"enable_context_editing,omitempty"`
	MaxContextTokens       *int           `json:"max_context_tokens,omitempty"`
	PreserveRecentMessages *int           `json:"preserve_recent_messages,omitempty"`
	PreserveSystemMessages *bool          `json:"preserve_system_messages,omitempty"`
	SummaryInstructions    *string        `json:"summary_instructions,omitempty"`
	SummaryLLMSettings     map[string]any `json:"summary_llm_settings,omitempty"`
}

// DecodeStrategyUpdate parses a PUT body, reporting a wrong-typed field by
// name rather than as an opaque "invalid request body".
func DecodeStrategyUpdate(raw []byte) (StrategyUpdate, *FieldError) {
	var update StrategyUpdate
	if err := json.Unmarshal(raw, &update); err != nil {
		return StrategyUpdate{}, decodeFieldError(err)
	}
	return update, nil
}

func decodeFieldError(err error) *FieldError {
	var typeErr *json.UnmarshalTypeError
	if errors.As(err, &typeErr) && typeErr.Field != "" {
		return fieldErrorf(typeErr.Field, "%s must be of type %s", typeErr.Field, typeErr.Type.String())
	}
	return &FieldError{Field: "", Message: "invalid request body"}
}

// Apply lays the update over a resolved strategy and validates the result.
//
// It validates the MERGED value, not the submitted fields: the cross-field
// rule (summary max_tokens < max_context_tokens) has to see both sides, and a
// request that moves only one of the two would otherwise be checked against a
// number it did not send.
func (s Strategy) Apply(update StrategyUpdate) (Strategy, *FieldError) {
	merged := s
	if update.Name != nil {
		merged.Name = *update.Name
	}
	if update.Enabled != nil {
		merged.Enabled = *update.Enabled
	}
	if update.EnableSummarization != nil {
		merged.EnableSummarization = *update.EnableSummarization
	}
	if update.EnableContextEditing != nil {
		merged.EnableContextEditing = *update.EnableContextEditing
	}
	if update.MaxContextTokens != nil {
		merged.MaxContextTokens = *update.MaxContextTokens
	}
	if update.PreserveRecentMessages != nil {
		merged.PreserveRecentMessages = *update.PreserveRecentMessages
	}
	if update.PreserveSystemMessages != nil {
		merged.PreserveSystemMessages = *update.PreserveSystemMessages
	}
	if update.SummaryInstructions != nil {
		merged.SummaryInstructions = *update.SummaryInstructions
	}
	if update.SummaryLLMSettings != nil {
		merged.SummaryLLMSettings = update.SummaryLLMSettings
	}
	merged.normalizeSummaryLLMSettings()
	if fieldErr := merged.Validate(); fieldErr != nil {
		return Strategy{}, fieldErr
	}
	return merged, nil
}
