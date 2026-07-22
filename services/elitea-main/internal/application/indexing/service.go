package indexing

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strconv"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
)

const indexStartIdempotencyPrefix = "index-start-v1:"

type AuthoritativeInputResolver interface {
	Resolve(context.Context, StartRequest) (AuthoritativeInputs, error)
}

type IndexAdmissionSubmitter interface {
	Submit(context.Context, SubmitRequest) (executionapp.AdmissionOutcome, error)
}

// StartService is the application boundary between the current UI request and
// the durable index runtime. It resolves saved server-side state before
// admission; client toolkit settings and credentials have no field here.
type StartService struct {
	resolver   AuthoritativeInputResolver
	admissions IndexAdmissionSubmitter
	newID      executionapp.IDGenerator
}

func NewStartService(
	resolver AuthoritativeInputResolver,
	admissions IndexAdmissionSubmitter,
	newID executionapp.IDGenerator,
) (*StartService, error) {
	if resolver == nil || admissions == nil || newID == nil {
		return nil, errors.New("index start dependencies are required")
	}
	return &StartService{resolver: resolver, admissions: admissions, newID: newID}, nil
}

func (s *StartService) StartIndexData(ctx context.Context, request StartRequest) (StartOutcome, error) {
	if ctx == nil {
		return StartOutcome{}, ErrInvalidIndexStart
	}
	if err := ctx.Err(); err != nil {
		return StartOutcome{}, err
	}
	if err := request.Validate(); err != nil || request.ToolkitID > math.MaxInt32 {
		return StartOutcome{}, ErrInvalidIndexStart
	}

	inputs, err := s.resolver.Resolve(ctx, request.Clone())
	if err != nil {
		return StartOutcome{}, err
	}
	idempotencyKey, err := s.idempotencyKey(request)
	if err != nil {
		return StartOutcome{}, err
	}

	projectID := strconv.FormatInt(request.ProjectID, 10)
	actorID := strconv.FormatInt(request.ActorUserID, 10)
	outcome, err := s.admissions.Submit(ctx, SubmitRequest{
		Identity: executionapp.AdmissionIdentity{
			// The current platform has project-local schemas but no independent
			// tenant identifier. Phase one therefore uses the authorized project
			// as the tenant/resource/projection boundary, matching validation.
			TenantID:            projectID,
			ResourceProjectID:   projectID,
			ProjectionProjectID: projectID,
			ActorID:             actorID,
		},
		IdempotencyKey: idempotencyKey,
		ToolkitID:      int32(request.ToolkitID),
		Initiator:      executiondomain.IndexIngestInitiatorUser,
		Inputs:         inputs,
	})
	if err != nil {
		return StartOutcome{}, err
	}
	if outcome.ExecutionID == "" || outcome.CommandID == "" || outcome.AdmittedAt.IsZero() || !outcome.Deadline.After(outcome.AdmittedAt) {
		return StartOutcome{}, errors.New("index admission returned an invalid outcome")
	}
	return StartOutcome{TaskID: outcome.ExecutionID}, nil
}

func (s *StartService) idempotencyKey(request StartRequest) (string, error) {
	correlation := []byte(request.StreamID + "\x00" + request.MessageID)
	if request.StreamID == "" && request.MessageID == "" {
		nonce, err := s.newID()
		if err != nil {
			return "", fmt.Errorf("generate index start correlation: %w", err)
		}
		if nonce == "" {
			return "", errors.New("index start correlation generator returned an empty ID")
		}
		correlation = []byte(nonce)
	}

	material := make([]byte, 0, len(correlation)+64)
	material = appendLengthPrefixed(material, strconv.FormatInt(request.ProjectID, 10))
	material = appendLengthPrefixed(material, strconv.FormatInt(request.ActorUserID, 10))
	material = appendLengthPrefixed(material, strconv.FormatInt(request.ToolkitID, 10))
	material = appendLengthPrefixed(material, string(correlation))
	digest := sha256.Sum256(material)
	return indexStartIdempotencyPrefix + hex.EncodeToString(digest[:]), nil
}

func appendLengthPrefixed(target []byte, value string) []byte {
	var length [8]byte
	binary.BigEndian.PutUint64(length[:], uint64(len(value)))
	target = append(target, length[:]...)
	return append(target, value...)
}

var _ interface {
	StartIndexData(context.Context, StartRequest) (StartOutcome, error)
} = (*StartService)(nil)
