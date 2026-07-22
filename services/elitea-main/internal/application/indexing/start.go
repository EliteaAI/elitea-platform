package indexing

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
)

const (
	IndexDataToolName         = "index_data"
	MaxToolParametersBytes    = executiondomain.MaxInputEntryContentBytes
	MaxRequestedLLMBytes      = 128 << 10
	MaxClientCorrelationBytes = 512
	MaxCurrentIndexNameRunes  = 7
)

var (
	ErrInvalidIndexStart = errors.New("invalid index start request")
	ErrToolkitNotVisible = errors.New("toolkit is not visible in the requested project")
)

// StartRequest contains only caller-controlled invocation data and stable
// server-derived identities. Toolkit settings, deployment tokens and expanded
// secrets are deliberately absent. RequestedLLMSettings is an untrusted UI
// preference object; the injected use case must allowlist it and resolve the
// authoritative model configuration and credentials from project state after
// checking toolkit visibility.
type StartRequest struct {
	ProjectID            int64
	ActorUserID          int64
	ToolkitID            int64
	ToolParameters       json.RawMessage
	RequestedLLMModel    *string
	RequestedLLMSettings json.RawMessage
	StreamID             string
	MessageID            string
}

func (r StartRequest) Validate() error {
	if r.ProjectID <= 0 || r.ActorUserID <= 0 || r.ToolkitID <= 0 {
		return ErrInvalidIndexStart
	}
	if !validJSONObject(r.ToolParameters, MaxToolParametersBytes) ||
		!validJSONObject(r.RequestedLLMSettings, MaxRequestedLLMBytes) {
		return ErrInvalidIndexStart
	}
	if _, err := indexNameFromToolParameters(r.ToolParameters); err != nil {
		return ErrInvalidIndexStart
	}
	if r.RequestedLLMModel != nil && !validOptionalText(*r.RequestedLLMModel, MaxClientCorrelationBytes) {
		return ErrInvalidIndexStart
	}
	if !validOptionalText(r.StreamID, MaxClientCorrelationBytes) ||
		!validOptionalText(r.MessageID, MaxClientCorrelationBytes) {
		return ErrInvalidIndexStart
	}
	return nil
}

// Clone prevents a use case from retaining aliases into an HTTP decoder's
// buffers. Requested LLM settings remain untrusted preferences; a use case may
// allowlist them but must never treat them as credential material.
func (r StartRequest) Clone() StartRequest {
	r.ToolParameters = bytes.Clone(r.ToolParameters)
	r.RequestedLLMSettings = bytes.Clone(r.RequestedLLMSettings)
	if r.RequestedLLMModel != nil {
		model := *r.RequestedLLMModel
		r.RequestedLLMModel = &model
	}
	return r
}

type StartOutcome struct {
	TaskID string
}

func validJSONObject(value []byte, limit int) bool {
	if len(value) == 0 || len(value) > limit || !json.Valid(value) {
		return false
	}
	trimmed := bytes.TrimSpace(value)
	return len(trimmed) >= 2 && trimmed[0] == '{' && trimmed[len(trimmed)-1] == '}'
}

func validOptionalText(value string, limit int) bool {
	return len(value) <= limit && utf8.ValidString(value) && !strings.ContainsAny(value, "\x00\r\n")
}

func indexNameFromToolParameters(parameters []byte) (string, error) {
	var value struct {
		IndexName string `json:"index_name"`
	}
	if err := json.Unmarshal(parameters, &value); err != nil {
		return "", ErrInvalidIndexStart
	}
	length := utf8.RuneCountInString(value.IndexName)
	if length < 1 || length > MaxCurrentIndexNameRunes || strings.TrimSpace(value.IndexName) == "" {
		return "", ErrInvalidIndexStart
	}
	return value.IndexName, nil
}
