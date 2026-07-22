package indexing

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"google.golang.org/protobuf/proto"
)

const (
	indexToolkitConfigurationEntryID = "toolkit-configuration"
	indexToolParametersEntryID       = "tool-parameters"
	indexLLMModelEntryID             = "llm-model"
	indexLLMConfigurationEntryID     = "llm-configuration"
	indexMCPReferencesEntryID        = "mcp-credential-references"
	indexInputMediaType              = executiondomain.SettingsJSONMediaType
	maxIndexAdmissionStringBytes     = 256
)

var ErrInvalidAuthoritativeIndexInput = errors.New("invalid authoritative index input")

// AuthoritativeInputs are selected by a project-scoped resolver after toolkit
// visibility and authorization. The resolver contract supplies immutable
// credential references, not redeemed values. This type deliberately does not
// guess whether arbitrary JSON strings are secrets; redemption remains outside
// admission and requires a claimed data-plane grant.
type AuthoritativeInputs struct {
	ToolkitConfiguration json.RawMessage
	ToolParameters       json.RawMessage
	LLMModel             *string
	LLMConfiguration     json.RawMessage
	MCPReferences        json.RawMessage
}

func (i AuthoritativeInputs) validate() error {
	if !validBoundedJSONObject(i.ToolkitConfiguration) || !validBoundedJSONObject(i.ToolParameters) {
		return ErrInvalidAuthoritativeIndexInput
	}
	if i.LLMModel != nil {
		encoded, err := json.Marshal(*i.LLMModel)
		if err != nil || len(encoded) == 0 || len(encoded) > executiondomain.MaxInputEntryContentBytes {
			return ErrInvalidAuthoritativeIndexInput
		}
	}
	for _, optional := range []json.RawMessage{i.LLMConfiguration, i.MCPReferences} {
		if len(optional) > 0 && !validBoundedJSONObject(optional) {
			return ErrInvalidAuthoritativeIndexInput
		}
	}
	return nil
}

func validBoundedJSONObject(value []byte) bool {
	if len(value) == 0 || len(value) > executiondomain.MaxInputEntryContentBytes || !json.Valid(value) {
		return false
	}
	var object map[string]json.RawMessage
	return json.Unmarshal(value, &object) == nil && object != nil
}

type InputProfile struct {
	Classification        string
	RequiredGrantAudience string
}

func (p InputProfile) validate() error {
	if p.Classification == "" || p.Classification == "synthetic" || p.RequiredGrantAudience == "" || len(p.Classification) > maxIndexAdmissionStringBytes || len(p.RequiredGrantAudience) > maxIndexAdmissionStringBytes {
		return ErrInvalidAuthoritativeIndexInput
	}
	return nil
}

type InputBundleFactory struct {
	profile InputProfile
	newID   executionapp.IDGenerator
}

func NewInputBundleFactory(profile InputProfile, newID executionapp.IDGenerator) (*InputBundleFactory, error) {
	if err := profile.validate(); err != nil {
		return nil, err
	}
	if newID == nil {
		return nil, errors.New("index input ID generator is required")
	}
	return &InputBundleFactory{profile: profile, newID: newID}, nil
}

func (f *InputBundleFactory) Build(ctx context.Context, inputs AuthoritativeInputs) (executiondomain.InputBundle, executiondomain.IndexIngestBinding, error) {
	if err := ctx.Err(); err != nil {
		return executiondomain.InputBundle{}, executiondomain.IndexIngestBinding{}, err
	}
	if err := inputs.validate(); err != nil {
		return executiondomain.InputBundle{}, executiondomain.IndexIngestBinding{}, err
	}
	bundleID, err := f.newID()
	if err != nil {
		return executiondomain.InputBundle{}, executiondomain.IndexIngestBinding{}, fmt.Errorf("generate index input bundle ID: %w", err)
	}
	if bundleID == "" {
		return executiondomain.InputBundle{}, executiondomain.IndexIngestBinding{}, errors.New("index input ID generator returned an empty ID")
	}
	bundleVersion := "admission:" + bundleID

	type entrySource struct {
		id      string
		role    string
		content []byte
	}
	sources := []entrySource{
		{id: indexToolkitConfigurationEntryID, role: executiondomain.IndexToolkitConfigurationRole, content: inputs.ToolkitConfiguration},
		{id: indexToolParametersEntryID, role: executiondomain.IndexToolParametersRole, content: inputs.ToolParameters},
	}
	if inputs.LLMModel != nil {
		encoded, err := json.Marshal(*inputs.LLMModel)
		if err != nil {
			return executiondomain.InputBundle{}, executiondomain.IndexIngestBinding{}, ErrInvalidAuthoritativeIndexInput
		}
		sources = append(sources, entrySource{id: indexLLMModelEntryID, role: executiondomain.IndexLLMModelRole, content: encoded})
	}
	if len(inputs.LLMConfiguration) > 0 {
		sources = append(sources, entrySource{id: indexLLMConfigurationEntryID, role: executiondomain.IndexLLMConfigurationRole, content: inputs.LLMConfiguration})
	}
	if len(inputs.MCPReferences) > 0 {
		sources = append(sources, entrySource{id: indexMCPReferencesEntryID, role: executiondomain.IndexMCPTokensRole, content: inputs.MCPReferences})
	}

	entries := make([]executiondomain.InputEntry, 0, len(sources))
	wireEntries := make([]*runtimev1.ExecutionInputEntryV1, 0, len(sources))
	for _, source := range sources {
		contentID, err := f.newID()
		if err != nil {
			return executiondomain.InputBundle{}, executiondomain.IndexIngestBinding{}, fmt.Errorf("generate index input content ID: %w", err)
		}
		if contentID == "" {
			return executiondomain.InputBundle{}, executiondomain.IndexIngestBinding{}, errors.New("index input ID generator returned an empty ID")
		}
		content := append([]byte(nil), source.content...)
		digest := runtimedomain.SHA256(content)
		version := digest.String()
		entries = append(entries, executiondomain.InputEntry{
			ID:                    source.id,
			Version:               version,
			SemanticRole:          source.role,
			ContentID:             contentID,
			MediaType:             indexInputMediaType,
			Classification:        f.profile.Classification,
			RequiredGrantAudience: f.profile.RequiredGrantAudience,
			ContentDigest:         digest,
			ContentLength:         int64(len(content)),
			Content:               content,
		})
		wireEntries = append(wireEntries, &runtimev1.ExecutionInputEntryV1{
			EntryId:          source.id,
			ImmutableVersion: version,
			SemanticRole:     source.role,
			Content: &runtimev1.ScopedContentReferenceV1{
				ContentId:             contentID,
				ImmutableVersion:      version,
				MediaType:             indexInputMediaType,
				ByteLength:            uint64(len(content)),
				Digest:                indexDigestProto(digest),
				Classification:        f.profile.Classification,
				RequiredGrantAudience: f.profile.RequiredGrantAudience,
			},
		})
	}

	manifest, err := proto.MarshalOptions{Deterministic: true}.Marshal(&runtimev1.ExecutionInputBundleV1{
		InputBundleId:    bundleID,
		ImmutableVersion: bundleVersion,
		Entries:          wireEntries,
	})
	if err != nil {
		return executiondomain.InputBundle{}, executiondomain.IndexIngestBinding{}, fmt.Errorf("encode index input manifest: %w", err)
	}
	if len(manifest) == 0 || len(manifest) > 64*1024 {
		return executiondomain.InputBundle{}, executiondomain.IndexIngestBinding{}, ErrInvalidAuthoritativeIndexInput
	}
	bundle := executiondomain.InputBundle{
		ID:        bundleID,
		Version:   bundleVersion,
		MediaType: executiondomain.InputBundleManifestMediaType,
		Digest:    runtimedomain.SHA256(manifest),
		Manifest:  manifest,
		Entries:   entries,
	}
	binding := executiondomain.IndexIngestBinding{
		ToolkitConfigurationEntryID: indexToolkitConfigurationEntryID,
		ToolParametersEntryID:       indexToolParametersEntryID,
	}
	if inputs.LLMModel != nil {
		binding.LLMModelEntryID = indexLLMModelEntryID
	}
	if len(inputs.LLMConfiguration) > 0 {
		binding.LLMConfigurationEntryID = indexLLMConfigurationEntryID
	}
	if len(inputs.MCPReferences) > 0 {
		binding.MCPTokensEntryID = indexMCPReferencesEntryID
	}
	return bundle, binding, nil
}

func indexDigestProto(digest runtimedomain.Digest) *runtimev1.DigestV1 {
	return &runtimev1.DigestV1{
		Algorithm: runtimev1.DigestAlgorithmV1_DIGEST_ALGORITHM_V1_SHA256,
		Value:     append([]byte(nil), digest[:]...),
	}
}

type SubmitRequest struct {
	Identity       executionapp.AdmissionIdentity
	IdempotencyKey string
	ToolkitID      int32
	Initiator      executiondomain.IndexIngestInitiator
	Inputs         AuthoritativeInputs
}

type Admission struct {
	Record  executiondomain.Admission
	Binding executiondomain.IndexIngestBinding
}

type AtomicAdmissionStore interface {
	AdmitIndexIngest(context.Context, Admission) (executionapp.AdmissionOutcome, error)
}

type AdmissionService struct {
	store   AtomicAdmissionStore
	factory *InputBundleFactory
	now     func() time.Time
	newID   executionapp.IDGenerator
}

func NewAdmissionService(store AtomicAdmissionStore, factory *InputBundleFactory, now func() time.Time, newID executionapp.IDGenerator) (*AdmissionService, error) {
	if store == nil || factory == nil || newID == nil {
		return nil, errors.New("index admission dependencies are required")
	}
	if now == nil {
		now = time.Now
	}
	return &AdmissionService{store: store, factory: factory, now: now, newID: newID}, nil
}

func (s *AdmissionService) Submit(ctx context.Context, request SubmitRequest) (executionapp.AdmissionOutcome, error) {
	if request.Identity.TenantID == "" || request.Identity.ResourceProjectID == "" || request.Identity.ProjectionProjectID == "" || request.Identity.ActorID == "" || request.IdempotencyKey == "" || len(request.IdempotencyKey) > 200 || request.ToolkitID <= 0 || !request.Initiator.Valid() {
		return executionapp.AdmissionOutcome{}, ErrInvalidIndexStart
	}
	if err := request.Inputs.validate(); err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("%w: %v", ErrInvalidIndexStart, err)
	}
	indexName, err := indexNameFromToolParameters(request.Inputs.ToolParameters)
	if err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	bundle, binding, err := s.factory.Build(ctx, request.Inputs)
	if err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	binding.ToolkitID = request.ToolkitID
	binding.IndexName = indexName
	binding.Initiator = request.Initiator
	if err := binding.Validate(bundle); err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("%w: %v", ErrInvalidIndexStart, err)
	}

	executionID, commandID, outboxID, err := s.allocateAdmissionIDs()
	if err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	createdAt := s.now().UTC()
	record := executiondomain.Admission{
		IdempotencyScope: request.Identity.TenantID + "/" + request.Identity.ResourceProjectID + "/" + request.Identity.ActorID,
		IdempotencyKey:   request.IdempotencyKey,
		RequestDigest:    indexRequestDigest(request, indexName),
		InputBundle:      bundle.Clone(),
		Job: executiondomain.Job{
			ID:                  executionID,
			CommandID:           commandID,
			TenantID:            request.Identity.TenantID,
			ResourceProjectID:   request.Identity.ResourceProjectID,
			ProjectionProjectID: request.Identity.ProjectionProjectID,
			ActorID:             request.Identity.ActorID,
			CapabilityID:        executiondomain.IndexIngestCapability,
			Generation:          1,
			State:               executiondomain.JobPending,
			CreatedAt:           createdAt,
		},
		Outbox: executiondomain.OutboxRecord{
			ID:          outboxID,
			CommandID:   commandID,
			ExecutionID: executionID,
			Generation:  1,
			CreatedAt:   createdAt,
		},
	}
	if err := record.Validate(); err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("%w: %v", ErrInvalidIndexStart, err)
	}
	outcome, err := s.store.AdmitIndexIngest(ctx, Admission{Record: record, Binding: binding})
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("admit index ingest: %w", err)
	}
	if outcome.ExecutionID == "" || outcome.CommandID == "" || outcome.AdmittedAt.IsZero() || !outcome.Deadline.After(outcome.AdmittedAt) {
		return executionapp.AdmissionOutcome{}, errors.New("index admission store returned invalid durable outcome")
	}
	return outcome, nil
}

func (s *AdmissionService) allocateAdmissionIDs() (string, string, string, error) {
	values := make([]string, 3)
	for index := range values {
		value, err := s.newID()
		if err != nil {
			return "", "", "", fmt.Errorf("generate index admission ID: %w", err)
		}
		if value == "" {
			return "", "", "", errors.New("index admission ID generator returned an empty ID")
		}
		values[index] = value
	}
	return values[0], values[1], values[2], nil
}

func indexNameFromToolParameters(parameters []byte) (string, error) {
	var value struct {
		IndexName string `json:"index_name"`
	}
	if err := json.Unmarshal(parameters, &value); err != nil || value.IndexName == "" || len(value.IndexName) > maxIndexAdmissionStringBytes {
		return "", ErrInvalidIndexStart
	}
	return value.IndexName, nil
}

func indexRequestDigest(request SubmitRequest, indexName string) runtimedomain.Digest {
	values := [][]byte{
		[]byte(request.Identity.TenantID),
		[]byte(request.Identity.ResourceProjectID),
		[]byte(request.Identity.ProjectionProjectID),
		[]byte(request.Identity.ActorID),
		[]byte(strconv.FormatInt(int64(request.ToolkitID), 10)),
		[]byte(indexName),
		[]byte(request.Initiator),
		request.Inputs.ToolkitConfiguration,
		request.Inputs.ToolParameters,
	}
	if request.Inputs.LLMModel != nil {
		values = append(values, []byte(*request.Inputs.LLMModel))
	} else {
		values = append(values, nil)
	}
	values = append(values, request.Inputs.LLMConfiguration, request.Inputs.MCPReferences)
	material := make([]byte, 0, 512)
	material = append(material, "elitea.index.ingest.admission.v1\x00"...)
	for _, value := range values {
		var length [8]byte
		binary.BigEndian.PutUint64(length[:], uint64(len(value)))
		material = append(material, length[:]...)
		material = append(material, value...)
	}
	return runtimedomain.SHA256(material)
}
