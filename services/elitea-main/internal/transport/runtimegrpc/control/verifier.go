package control

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"fmt"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	runtimegrpc "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/transport/runtimegrpc"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

var (
	ErrCommandAuthentication  = errors.New("worker command authentication failed")
	ErrCommandIncompatible    = errors.New("worker command protocol is incompatible")
	ErrMalformedWorkerCommand = errors.New("worker command is malformed")
)

type CommandVerifier interface {
	Verify(ctx context.Context, envelope *runtimev1.SignedWorkerCommandEnvelopeV1) (*runtimev1.WorkerCommandV1, error)
}

type ConformanceVerifierConfig struct {
	EnvelopeSchemaRevision string
	ProtocolRevision       string
	CapabilityVersion      string
	LimitsRevision         string
	KeyID                  string
	HMACKey                []byte
	MaxWorkerCommandBytes  int
	MaxInputManifestBytes  uint64
	MaxStringBytes         int
}

// ConformanceCommandVerifier accepts only the public test-vector HMAC profile.
// It is intentionally impossible to construct as a production verifier.
type ConformanceCommandVerifier struct {
	config ConformanceVerifierConfig
}

func NewConformanceCommandVerifier(config ConformanceVerifierConfig) (*ConformanceCommandVerifier, error) {
	if config.EnvelopeSchemaRevision == "" || config.ProtocolRevision == "" || config.CapabilityVersion == "" || config.LimitsRevision == "" || config.KeyID == "" {
		return nil, errors.New("all conformance command revisions and key ID are required")
	}
	if len(config.HMACKey) < sha256.Size || config.MaxWorkerCommandBytes <= 0 || config.MaxInputManifestBytes == 0 || config.MaxStringBytes <= 0 {
		return nil, errors.New("invalid conformance verifier limits or key")
	}
	config.HMACKey = append([]byte(nil), config.HMACKey...)
	return &ConformanceCommandVerifier{config: config}, nil
}

func (v *ConformanceCommandVerifier) Verify(ctx context.Context, envelope *runtimev1.SignedWorkerCommandEnvelopeV1) (*runtimev1.WorkerCommandV1, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if envelope == nil || hasUnknownFields(envelope.ProtoReflect()) {
		return nil, ErrCommandAuthentication
	}
	if envelope.GetEnvelopeSchemaRevision() != v.config.EnvelopeSchemaRevision ||
		envelope.GetSignatureProfile() != runtimev1.SignatureProfileV1_SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256 ||
		envelope.GetKeyId() != v.config.KeyID {
		return nil, ErrCommandAuthentication
	}
	commandBytes := envelope.GetWorkerCommandBytes()
	if len(commandBytes) == 0 || len(commandBytes) > v.config.MaxWorkerCommandBytes {
		return nil, ErrMalformedWorkerCommand
	}
	if !validDigestProto(envelope.GetWorkerCommandDigest(), commandBytes) {
		return nil, ErrCommandAuthentication
	}
	expected := hmac.New(sha256.New, v.config.HMACKey)
	_, _ = expected.Write(commandBytes)
	if len(envelope.GetSignature()) != sha256.Size || !hmac.Equal(expected.Sum(nil), envelope.GetSignature()) {
		return nil, ErrCommandAuthentication
	}

	descriptor := (&runtimev1.WorkerCommandV1{}).ProtoReflect().Descriptor()
	if err := runtimegrpc.ScanStrictMessage(commandBytes, descriptor); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMalformedWorkerCommand, err)
	}
	command := &runtimev1.WorkerCommandV1{}
	if err := (proto.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(commandBytes, command); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMalformedWorkerCommand, err)
	}
	if hasUnknownFields(command.ProtoReflect()) {
		return nil, ErrMalformedWorkerCommand
	}
	canonicalCommandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil || !bytes.Equal(canonicalCommandBytes, commandBytes) {
		return nil, ErrMalformedWorkerCommand
	}
	if err := v.validateCommand(command); err != nil {
		return nil, err
	}
	return command, nil
}

func (v *ConformanceCommandVerifier) validateCommand(command *runtimev1.WorkerCommandV1) error {
	if command.GetProtocolRevision() != v.config.ProtocolRevision || command.GetLimitsRevision() != v.config.LimitsRevision {
		return ErrCommandIncompatible
	}
	if command.GetCapabilityId() != "configuration.validate.v1" || command.GetCapabilityVersion() != v.config.CapabilityVersion || command.GetCommandType() != runtimev1.WorkerCommandTypeV1_WORKER_COMMAND_TYPE_V1_CONFIGURATION_VALIDATE {
		return ErrCommandIncompatible
	}
	validation := command.GetConfigurationValidation()
	input := command.GetInputBundleRef()
	if validation == nil || input == nil {
		return ErrMalformedWorkerCommand
	}
	values := []string{
		command.GetCommandId(), command.GetIdempotencyKey(), command.GetExecutionId(), command.GetRootExecutionId(),
		command.GetTenantId(), command.GetResourceProjectId(), command.GetProjectionProjectId(), command.GetPrincipalRef(),
		command.GetGrantTemplateId(), command.GetCapabilityId(), command.GetCapabilityVersion(), command.GetResourceClass(),
		command.GetIsolationClass(), input.GetInputBundleId(), input.GetImmutableVersion(), input.GetMediaType(),
		validation.GetConfigurationRevisionId(), validation.GetConfigurationType(), validation.GetCatalogRevision(),
		validation.GetSchemaId(), validation.GetSchemaRevision(), validation.GetSettingsEntryId(),
	}
	for _, value := range values {
		if value == "" || len(value) > v.config.MaxStringBytes {
			return ErrMalformedWorkerCommand
		}
	}
	if command.GetGeneration() == 0 || command.GetDispatchOrdinal() == 0 || command.GetPriority() == 0 || command.GetDeadlineUnixMillis() <= 0 {
		return ErrMalformedWorkerCommand
	}
	if input.GetByteLength() == 0 || input.GetByteLength() > v.config.MaxInputManifestBytes {
		return ErrMalformedWorkerCommand
	}
	if !validDigestMessage(input.GetDigest()) || !validDigestMessage(validation.GetCatalogDigest()) || !validDigestMessage(validation.GetSchemaDigest()) {
		return ErrMalformedWorkerCommand
	}
	return nil
}

func validDigestProto(digest *runtimev1.DigestV1, content []byte) bool {
	if !validDigestMessage(digest) {
		return false
	}
	actual := sha256.Sum256(content)
	return hmac.Equal(actual[:], digest.GetValue())
}

func validDigestMessage(digest *runtimev1.DigestV1) bool {
	return digest != nil && digest.GetAlgorithm() == runtimev1.DigestAlgorithmV1_DIGEST_ALGORITHM_V1_SHA256 && len(digest.GetValue()) == sha256.Size
}

func hasUnknownFields(message protoreflect.Message) bool {
	if len(message.GetUnknown()) != 0 {
		return true
	}
	unknown := false
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		if field.Kind() != protoreflect.MessageKind {
			return true
		}
		if field.IsList() {
			list := value.List()
			for i := 0; i < list.Len(); i++ {
				if hasUnknownFields(list.Get(i).Message()) {
					unknown = true
					return false
				}
			}
			return !unknown
		}
		unknown = hasUnknownFields(value.Message())
		return !unknown
	})
	return unknown
}
