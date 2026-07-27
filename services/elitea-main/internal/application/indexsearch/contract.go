// Package indexsearch defines the source-only compatibility seam for the
// current index retrieval tools. It intentionally has no HTTP route, database
// query, dispatcher or worker registration.
package indexsearch

import (
	"encoding/json"
	"errors"
	"fmt"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

const maxIdentityBytes = 256

var ErrInvalidContract = errors.New("invalid index search contract")

// Operation maps only the three current SDK tool names. It is not a search
// implementation: filter interpretation, reranking, full-text, extended
// search, output fields and current error/no-result rendering remain SDK-owned.
type Operation string

const (
	SearchIndex         Operation = "search_index"
	StepbackSearchIndex Operation = "stepback_search_index"
	ListIndexes         Operation = "list_indexes"
)

// AuthorizedScope is the already-authorized execution identity. A production
// admission path must obtain it from the current RBAC/tenant resolver, never
// from request JSON. Keeping it explicit makes a future caller prove project
// and principal binding before it can construct this contract.
type AuthorizedScope struct {
	TenantID            string
	ResourceProjectID   string
	ProjectionProjectID string
	PrincipalRef        string
}

func (s AuthorizedScope) Validate() error {
	for _, value := range []string{s.TenantID, s.ResourceProjectID, s.ProjectionProjectID, s.PrincipalRef} {
		if !validIdentity(value) {
			return ErrInvalidContract
		}
	}
	return nil
}

// AuthoritativeInputs are loaded by an authorized server-side resolver. The
// JSON values are intentionally opaque: accepting or rejecting individual
// search fields here would drift from the SDK Pydantic/tool implementation.
// ToolkitConfiguration binds the current vector-store, embedding-model,
// dimension and collection settings as one immutable value.
type AuthoritativeInputs struct {
	ToolkitConfiguration json.RawMessage
	ToolParameters       json.RawMessage
	LLMModel             *string
	LLMConfiguration     json.RawMessage
	MCPTokens            json.RawMessage
}

func (i AuthoritativeInputs) Clone() AuthoritativeInputs {
	i.ToolkitConfiguration = append(json.RawMessage(nil), i.ToolkitConfiguration...)
	i.ToolParameters = append(json.RawMessage(nil), i.ToolParameters...)
	i.LLMConfiguration = append(json.RawMessage(nil), i.LLMConfiguration...)
	i.MCPTokens = append(json.RawMessage(nil), i.MCPTokens...)
	if i.LLMModel != nil {
		value := *i.LLMModel
		i.LLMModel = &value
	}
	return i
}

func (i AuthoritativeInputs) Validate() error {
	if !validJSONObject(i.ToolkitConfiguration) || !validJSONObject(i.ToolParameters) {
		return ErrInvalidContract
	}
	for _, optional := range []json.RawMessage{i.LLMConfiguration, i.MCPTokens} {
		if len(optional) > 0 && !validJSONObject(optional) {
			return ErrInvalidContract
		}
	}
	if i.LLMModel != nil && !validIdentity(*i.LLMModel) {
		return ErrInvalidContract
	}
	return nil
}

// Request contains no raw authorization decision and no caller-selected model
// binding. Admission supplies Scope and Inputs after the existing RBAC and
// saved-configuration lookup complete.
type Request struct {
	Scope     AuthorizedScope
	Operation Operation
	Inputs    AuthoritativeInputs
}

func (r Request) Validate() error {
	if err := r.Scope.Validate(); err != nil {
		return err
	}
	if _, err := r.Operation.proto(); err != nil {
		return err
	}
	return r.Inputs.Validate()
}

// InputBinding binds a resolved bundle entry to immutable content. Values are
// references only; no query, filter, model configuration or credential enters
// the control-plane command.
type InputBinding struct {
	EntryID string
	Version string
	Digest  runtimedomain.Digest
}

func (b InputBinding) Validate() error {
	if !validIdentity(b.EntryID) || !validIdentity(b.Version) {
		return ErrInvalidContract
	}
	return nil
}

// Bindings are the manifest entries produced by a future authorized admission
// transaction. LLM-related entries are optional because the current SDK owns
// its defaults when they are absent.
type Bindings struct {
	ToolkitConfiguration InputBinding
	ToolParameters       InputBinding
	LLMModel             *InputBinding
	LLMConfiguration     *InputBinding
	MCPTokens            *InputBinding
}

func (b Bindings) Validate() error {
	if err := b.ToolkitConfiguration.Validate(); err != nil {
		return err
	}
	if err := b.ToolParameters.Validate(); err != nil {
		return err
	}
	for _, optional := range []*InputBinding{b.LLMModel, b.LLMConfiguration, b.MCPTokens} {
		if optional != nil {
			if err := optional.Validate(); err != nil {
				return err
			}
		}
	}
	return nil
}

// Command returns the bounded, reference-only protocol message. Its caller
// must first validate the matching Request and persist the input bundle.
func Command(operation Operation, bindings Bindings) (*runtimev1.IndexSearchCommandV1, error) {
	wireOperation, err := operation.proto()
	if err != nil {
		return nil, err
	}
	if err := bindings.Validate(); err != nil {
		return nil, err
	}
	command := &runtimev1.IndexSearchCommandV1{
		Operation:                   wireOperation,
		ToolkitConfigurationEntryId: bindings.ToolkitConfiguration.EntryID,
		ToolParametersEntryId:       bindings.ToolParameters.EntryID,
	}
	if bindings.LLMModel != nil {
		command.LlmModelEntryId = bindings.LLMModel.EntryID
	}
	if bindings.LLMConfiguration != nil {
		command.LlmConfigurationEntryId = bindings.LLMConfiguration.EntryID
	}
	if bindings.MCPTokens != nil {
		command.McpTokensEntryId = bindings.MCPTokens.EntryID
	}
	return command, nil
}

// ArtifactReference is metadata for an immutable data-plane response. The
// canonical response content remains opaque because its result shape differs
// by operation and preserves current SDK branches verbatim.
type ArtifactReference struct {
	ID             string
	Version        string
	MediaType      string
	ByteLength     uint64
	Digest         runtimedomain.Digest
	Classification string
}

func (a ArtifactReference) Validate() error {
	for _, value := range []string{a.ID, a.Version, a.MediaType, a.Classification} {
		if !validIdentity(value) {
			return ErrInvalidContract
		}
	}
	return nil
}

// Result binds a future SDK response artifact to exactly the manifest entries
// consumed by that call. It is source-only until the matching admission,
// worker, artifact writer and projection are composed as one slice.
func Result(
	operation Operation,
	inputBundleID string,
	inputBundleDigest runtimedomain.Digest,
	bindings Bindings,
	artifact ArtifactReference,
) (*runtimev1.IndexSearchResultV1, error) {
	wireOperation, err := operation.proto()
	if err != nil {
		return nil, err
	}
	if !validIdentity(inputBundleID) || bindings.Validate() != nil || artifact.Validate() != nil {
		return nil, ErrInvalidContract
	}
	result := &runtimev1.IndexSearchResultV1{
		Operation:            wireOperation,
		InputBundleId:        inputBundleID,
		InputBundleDigest:    digestProto(inputBundleDigest),
		ToolkitConfiguration: bindingProto(bindings.ToolkitConfiguration),
		ToolParameters:       bindingProto(bindings.ToolParameters),
		ResultArtifact: &runtimev1.IndexSearchArtifactReferenceV1{
			ArtifactId:       artifact.ID,
			ImmutableVersion: artifact.Version,
			MediaType:        artifact.MediaType,
			ByteLength:       artifact.ByteLength,
			Digest:           digestProto(artifact.Digest),
			Classification:   artifact.Classification,
		},
	}
	if bindings.LLMModel != nil {
		result.LlmModel = bindingProto(*bindings.LLMModel)
	}
	if bindings.LLMConfiguration != nil {
		result.LlmConfiguration = bindingProto(*bindings.LLMConfiguration)
	}
	if bindings.MCPTokens != nil {
		result.McpTokens = bindingProto(*bindings.MCPTokens)
	}
	return result, nil
}

func (o Operation) proto() (runtimev1.IndexSearchOperationV1, error) {
	switch o {
	case SearchIndex:
		return runtimev1.IndexSearchOperationV1_INDEX_SEARCH_OPERATION_V1_SEARCH_INDEX, nil
	case StepbackSearchIndex:
		return runtimev1.IndexSearchOperationV1_INDEX_SEARCH_OPERATION_V1_STEPBACK_SEARCH_INDEX, nil
	case ListIndexes:
		return runtimev1.IndexSearchOperationV1_INDEX_SEARCH_OPERATION_V1_LIST_INDEXES, nil
	default:
		return runtimev1.IndexSearchOperationV1_INDEX_SEARCH_OPERATION_V1_UNSPECIFIED, fmt.Errorf("%w: unsupported operation", ErrInvalidContract)
	}
}

func bindingProto(value InputBinding) *runtimev1.IndexSearchInputBindingV1 {
	return &runtimev1.IndexSearchInputBindingV1{
		EntryId:          value.EntryID,
		ImmutableVersion: value.Version,
		ContentDigest:    digestProto(value.Digest),
	}
}

func digestProto(value runtimedomain.Digest) *runtimev1.DigestV1 {
	return &runtimev1.DigestV1{
		Algorithm: runtimev1.DigestAlgorithmV1_DIGEST_ALGORITHM_V1_SHA256,
		Value:     append([]byte(nil), value[:]...),
	}
}

func validIdentity(value string) bool {
	return value != "" && len(value) <= maxIdentityBytes
}

func validJSONObject(value []byte) bool {
	if len(value) == 0 || !json.Valid(value) {
		return false
	}
	var object map[string]json.RawMessage
	return json.Unmarshal(value, &object) == nil && object != nil
}
