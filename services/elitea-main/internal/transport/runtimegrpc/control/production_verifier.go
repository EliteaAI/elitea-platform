package control

import (
	"context"
	"crypto/ed25519"
	"errors"
	"strings"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

// Ed25519PublicKeyResolver resolves one exact key ID. Implementations must not
// fall back to a default key. During rotation, old verification keys remain
// resolvable until every immutable prepared envelope using that key has
// settled or reached its durable deadline.
type Ed25519PublicKeyResolver interface {
	ResolveEd25519PublicKey(ctx context.Context, keyID string) (ed25519.PublicKey, error)
}

type ProductionVerifierConfig struct {
	EnvelopeSchemaRevision string
	ProtocolRevision       string
	CapabilityVersion      string
	LimitsRevision         string
	MaxWorkerCommandBytes  int
	MaxInputManifestBytes  uint64
	MaxStringBytes         int
}

// ProductionCommandVerifier accepts only the protocol-v1 ED25519 profile. It
// rejects the public conformance HMAC even when a resolver happens to know the
// supplied key ID.
type ProductionCommandVerifier struct {
	config   ProductionVerifierConfig
	resolver Ed25519PublicKeyResolver
}

func NewProductionCommandVerifier(config ProductionVerifierConfig, resolver Ed25519PublicKeyResolver) (*ProductionCommandVerifier, error) {
	if resolver == nil || config.EnvelopeSchemaRevision == "" || config.ProtocolRevision == "" || config.CapabilityVersion == "" || config.LimitsRevision == "" {
		return nil, errors.New("production verifier revisions and key resolver are required")
	}
	if config.MaxWorkerCommandBytes <= 0 || config.MaxInputManifestBytes == 0 || config.MaxStringBytes <= 0 {
		return nil, errors.New("production verifier limits must be positive")
	}
	return &ProductionCommandVerifier{config: config, resolver: resolver}, nil
}

func (v *ProductionCommandVerifier) Verify(ctx context.Context, envelope *runtimev1.SignedWorkerCommandEnvelopeV1) (*runtimev1.WorkerCommandV1, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if envelope == nil || hasUnknownFields(envelope.ProtoReflect()) || envelope.GetEnvelopeSchemaRevision() != v.config.EnvelopeSchemaRevision || envelope.GetSignatureProfile() != runtimev1.SignatureProfileV1_SIGNATURE_PROFILE_V1_ED25519 {
		return nil, ErrCommandAuthentication
	}
	keyID := envelope.GetKeyId()
	if keyID == "" || len(keyID) > v.config.MaxStringBytes || len(keyID) > 256 || strings.ContainsAny(keyID, "\r\n\x00") {
		return nil, ErrCommandAuthentication
	}
	commandBytes := envelope.GetWorkerCommandBytes()
	if len(commandBytes) == 0 || len(commandBytes) > v.config.MaxWorkerCommandBytes {
		return nil, ErrMalformedWorkerCommand
	}
	if !validDigestProto(envelope.GetWorkerCommandDigest(), commandBytes) || len(envelope.GetSignature()) != ed25519.SignatureSize {
		return nil, ErrCommandAuthentication
	}
	publicKey, err := v.resolver.ResolveEd25519PublicKey(ctx, keyID)
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return nil, err
	}
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return nil, ErrCommandAuthentication
	}
	input, err := runtimedomain.Ed25519WorkerCommandSigningInput(commandBytes)
	if err != nil || !ed25519.Verify(publicKey, input, envelope.GetSignature()) {
		return nil, ErrCommandAuthentication
	}
	return decodeAndValidateCommand(commandBytes, commandValidationConfig{
		ProtocolRevision:      v.config.ProtocolRevision,
		CapabilityVersion:     v.config.CapabilityVersion,
		LimitsRevision:        v.config.LimitsRevision,
		MaxInputManifestBytes: v.config.MaxInputManifestBytes,
		MaxStringBytes:        v.config.MaxStringBytes,
	})
}

var _ CommandVerifier = (*ProductionCommandVerifier)(nil)
