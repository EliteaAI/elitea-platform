package redisdispatch

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"github.com/redis/go-redis/v9"
	"google.golang.org/protobuf/proto"
)

type Signature struct {
	Profile runtimev1.SignatureProfileV1
	KeyID   string
	Value   []byte
}

// CommandSigner signs the exact deterministic WorkerCommandV1 bytes. Protocol
// v1 currently defines only a conformance-only signature profile, so
// production composition must remain disabled until a production profile and
// workload key source are added to the contract.
type CommandSigner interface {
	SignWorkerCommand(ctx context.Context, exactCommandBytes []byte) (Signature, error)
}

type StreamAppender interface {
	Append(ctx context.Context, stream, field string, value []byte) (entryID string, err error)
}

type ProducerConfig struct {
	Stream                 string
	ProtocolRevision       string
	EnvelopeSchemaRevision string
	Limits                 Limits
	// AllowTestOnlyHMAC must be set only by offline conformance composition.
	// Production leaves it false and fails closed until a production signature
	// profile is defined by the protocol.
	AllowTestOnlyHMAC bool
}

type Producer struct {
	config   ProducerConfig
	signer   CommandSigner
	appender StreamAppender
}

func NewProducer(config ProducerConfig, signer CommandSigner, appender StreamAppender) (*Producer, error) {
	if signer == nil || appender == nil {
		return nil, errors.New("Redis signer and stream appender are required")
	}
	if config.Stream == "" || len(config.Stream) > 256 || strings.ContainsAny(config.Stream, " \r\n\x00") {
		return nil, errors.New("invalid Redis command stream")
	}
	if config.ProtocolRevision == "" || config.EnvelopeSchemaRevision == "" {
		return nil, errors.New("protocol and envelope revisions are required")
	}
	if !config.AllowTestOnlyHMAC {
		return nil, errors.New("production worker-command signature profile is not available")
	}
	if err := config.Limits.validate(); err != nil {
		return nil, err
	}
	return &Producer{config: config, signer: signer, appender: appender}, nil
}

func (p *Producer) PrepareValidation(ctx context.Context, dispatch executionapp.ValidationDispatch) (executionapp.PreparedCommandEnvelope, error) {
	if dispatch.LimitsRevision != p.config.Limits.Revision {
		return executionapp.PreparedCommandEnvelope{}, executionapp.ErrInvalidDispatch
	}
	command, err := validationWorkerCommand(p.config.ProtocolRevision, dispatch)
	if err != nil {
		return executionapp.PreparedCommandEnvelope{}, err
	}
	if err := validateBoundedStrings(command, p.config.Limits.MaxStringBytes); err != nil {
		return executionapp.PreparedCommandEnvelope{}, err
	}

	commandBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		return executionapp.PreparedCommandEnvelope{}, fmt.Errorf("encode worker command: %w", err)
	}
	if len(commandBytes) > p.config.Limits.MaxWorkerCommandBytes {
		return executionapp.PreparedCommandEnvelope{}, ErrControlMessageLimitExceeded
	}
	commandDigest := runtimedomain.SHA256(commandBytes)

	signature, err := p.signer.SignWorkerCommand(ctx, append([]byte(nil), commandBytes...))
	if err != nil {
		return executionapp.PreparedCommandEnvelope{}, fmt.Errorf("sign worker command: %w", err)
	}
	if !p.config.AllowTestOnlyHMAC || signature.Profile != runtimev1.SignatureProfileV1_SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256 || signature.KeyID == "" || len(signature.KeyID) > p.config.Limits.MaxStringBytes || strings.ContainsRune(signature.KeyID, '\x00') || len(signature.Value) == 0 || len(signature.Value) > p.config.Limits.MaxSignatureBytes {
		return executionapp.PreparedCommandEnvelope{}, errors.New("invalid worker command signature")
	}
	envelope := &runtimev1.SignedWorkerCommandEnvelopeV1{
		EnvelopeSchemaRevision: p.config.EnvelopeSchemaRevision,
		SignatureProfile:       signature.Profile,
		KeyId:                  signature.KeyID,
		WorkerCommandBytes:     commandBytes,
		WorkerCommandDigest:    digestProto(commandDigest),
		Signature:              append([]byte(nil), signature.Value...),
	}
	envelopeBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(envelope)
	if err != nil {
		return executionapp.PreparedCommandEnvelope{}, fmt.Errorf("encode signed worker command: %w", err)
	}
	if len(envelopeBytes) > p.config.Limits.MaxSignedEnvelopeBytes || len(envelopeBytes) > p.config.Limits.MaxRedisFieldBytes || encodedRedisEntryBytes(redisEnvelopeField, envelopeBytes) > p.config.Limits.MaxRedisEntryBytes {
		return executionapp.PreparedCommandEnvelope{}, ErrControlMessageLimitExceeded
	}
	prepared := executionapp.PreparedCommandEnvelope{
		Bytes:            append([]byte(nil), envelopeBytes...),
		Digest:           runtimedomain.SHA256(envelopeBytes),
		SignatureProfile: int32(signature.Profile),
		KeyID:            signature.KeyID,
	}
	if err := p.validatePrepared(prepared); err != nil {
		return executionapp.PreparedCommandEnvelope{}, err
	}
	return prepared, nil
}

// AppendPrepared appends only a previously selected exact envelope. It never
// signs or re-encodes the command, so an unknown Redis success and every
// competing publisher retry use byte-identical control-plane data.
func (p *Producer) AppendPrepared(ctx context.Context, prepared executionapp.PreparedCommandEnvelope) error {
	if err := p.validatePrepared(prepared); err != nil {
		return err
	}
	if _, err := p.appender.Append(ctx, p.config.Stream, redisEnvelopeField, append([]byte(nil), prepared.Bytes...)); err != nil {
		return fmt.Errorf("append worker command reference: %w", err)
	}
	return nil
}

func (p *Producer) validatePrepared(prepared executionapp.PreparedCommandEnvelope) error {
	if err := prepared.Validate(); err != nil {
		return err
	}
	if len(prepared.Bytes) > p.config.Limits.MaxSignedEnvelopeBytes || len(prepared.Bytes) > p.config.Limits.MaxRedisFieldBytes || encodedRedisEntryBytes(redisEnvelopeField, prepared.Bytes) > p.config.Limits.MaxRedisEntryBytes {
		return ErrControlMessageLimitExceeded
	}

	envelope := &runtimev1.SignedWorkerCommandEnvelopeV1{}
	if err := (proto.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(prepared.Bytes, envelope); err != nil || len(envelope.ProtoReflect().GetUnknown()) != 0 {
		return executionapp.ErrInvalidPreparedEnvelope
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(envelope)
	if err != nil || !bytes.Equal(canonical, prepared.Bytes) {
		return executionapp.ErrInvalidPreparedEnvelope
	}
	if envelope.GetEnvelopeSchemaRevision() != p.config.EnvelopeSchemaRevision || envelope.GetSignatureProfile() != runtimev1.SignatureProfileV1(prepared.SignatureProfile) || envelope.GetSignatureProfile() != runtimev1.SignatureProfileV1_SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256 || envelope.GetKeyId() != prepared.KeyID || strings.ContainsRune(envelope.GetKeyId(), '\x00') {
		return executionapp.ErrInvalidPreparedEnvelope
	}
	if len(envelope.GetKeyId()) > p.config.Limits.MaxStringBytes || len(envelope.GetSignature()) == 0 || len(envelope.GetSignature()) > p.config.Limits.MaxSignatureBytes || len(envelope.GetWorkerCommandBytes()) == 0 || len(envelope.GetWorkerCommandBytes()) > p.config.Limits.MaxWorkerCommandBytes {
		return executionapp.ErrInvalidPreparedEnvelope
	}
	commandDigest := envelope.GetWorkerCommandDigest()
	actualCommandDigest := sha256.Sum256(envelope.GetWorkerCommandBytes())
	if commandDigest == nil || len(commandDigest.ProtoReflect().GetUnknown()) != 0 || commandDigest.GetAlgorithm() != runtimev1.DigestAlgorithmV1_DIGEST_ALGORITHM_V1_SHA256 || !bytes.Equal(commandDigest.GetValue(), actualCommandDigest[:]) {
		return executionapp.ErrInvalidPreparedEnvelope
	}
	return nil
}

func encodedRedisEntryBytes(field string, value []byte) int {
	// RESP array/bulk headers and the server-assigned stream ID are bounded by
	// this fixed conservative overhead for the one-field entry.
	const protocolOverhead = 128
	return len(field) + len(value) + protocolOverhead
}

type RedisXAdder interface {
	XAdd(ctx context.Context, args *redis.XAddArgs) *redis.StringCmd
}

type RedisStreamAppender struct {
	client RedisXAdder
}

func NewRedisStreamAppender(client RedisXAdder) (*RedisStreamAppender, error) {
	if client == nil {
		return nil, errors.New("dedicated Redis control client is required")
	}
	return &RedisStreamAppender{client: client}, nil
}

func (a *RedisStreamAppender) Append(ctx context.Context, stream, field string, value []byte) (string, error) {
	return a.client.XAdd(ctx, &redis.XAddArgs{
		Stream: stream,
		ID:     "*",
		Values: []any{field, append([]byte(nil), value...)},
	}).Result()
}
