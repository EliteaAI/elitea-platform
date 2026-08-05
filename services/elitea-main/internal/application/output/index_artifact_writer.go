package output

import (
	"context"
	"errors"
	"time"
)

// ArtifactGrant is the result of CreateArtifactGrant / ResolveArtifact: a
// short-lived, single-use transfer grant for one result artifact's bytes.
// Mirrors the REST API's own S15 transfer-grant shape (grant id + URL +
// expiry) — reused here for the runtime output plane per ADR-0014's
// "Artifact plane" (CreateArtifactGrant/CommitArtifact/ResolveArtifact,
// listed as future runtime control gRPC methods; this package only builds
// the isolated, non-transport logic those methods would eventually call).
type ArtifactGrant struct {
	GrantID   string
	URL       string
	ExpiresAt time.Time
}

// CreateArtifactGrantRequest is what a producer must already know before
// asking for somewhere to upload one result artifact's bytes: the exact
// reference it intends to commit (validated the same way
// ArtifactVerificationRequest.Artifact already is), plus the identity the
// eventual index-ingest completion will check it against.
type CreateArtifactGrantRequest struct {
	TenantID            string
	ResourceProjectID   string
	ProjectionProjectID string
	CommandID           string
	ExecutionID         string
	Generation          uint64
	Artifact            IndexArtifactReference
}

func (r CreateArtifactGrantRequest) Validate() error {
	if r.TenantID == "" || r.ResourceProjectID == "" || r.ProjectionProjectID == "" || r.CommandID == "" || r.ExecutionID == "" || r.Generation == 0 {
		return ErrInvalidIndexIngestOutput
	}
	return r.Artifact.Validate()
}

// CommitArtifactRequest names the grant to verify and settle. The identity
// and reference are supplied again rather than re-derived from the grant
// row, since the shared S15 elitea_storage.transfer_grants row only has
// room for MediaType/ByteLength/Digest (what CreateArtifactGrant stores on
// it) — CommitArtifact cross-checks exactly those three fields (plus
// ResourceProjectID, implicit in the grant lookup itself) against this
// request, so a commit whose uploaded bytes' size/type/digest disagree
// with the original grant is rejected. It does NOT cross-check ArtifactID,
// ImmutableVersion, ExecutionID, Generation, TenantID, ProjectionProjectID,
// CommandID, or Classification against what CreateArtifactGrant was
// originally called with — none of those have anywhere to be durably
// recorded on the grant row today, so a caller that mixes up which
// CommitArtifactRequest identity belongs to which grant ID is not caught
// here. This is a real, open gap (confirmed by S20c's own adversarial
// review, not yet closed): it must be resolved — e.g. by binding an
// identity digest to the grant, or by some other means — before any
// producer this writer's own caller does not fully trust is ever wired to
// it. The writer's zero production callers today (docs/plans/
// storage-migration-plan.md S20c) are what keeps this non-exploitable so
// far.
type CommitArtifactRequest struct {
	GrantID string
	CreateArtifactGrantRequest
}

func (r CommitArtifactRequest) Validate() error {
	if r.GrantID == "" {
		return ErrInvalidIndexIngestOutput
	}
	return r.CreateArtifactGrantRequest.Validate()
}

// ErrArtifactGrantConflict is CommitArtifact's outcome when a prior,
// durably-committed artifact already exists under the same (ArtifactID,
// ImmutableVersion) with different content than what this request just
// verified — as opposed to an exact retry (same grant or a fresh grant for
// literally the same bytes), which is idempotent and returns success.
var ErrArtifactGrantConflict = errors.New("index ingest artifact grant conflicts with a durably committed artifact")

// ArtifactGrantIssuer is the runtime output plane's own producer-facing
// writer for result artifacts (ADR-0014's Artifact plane), independent of
// ArtifactVerifier above (the index-ingest completion path's read-only
// consumer of the exact same durable rows this writes). S20c
// (docs/plans/storage-migration-plan.md) implements this on the S15 grant
// machinery and storage.ObjectStore, deliberately unwired from any
// producer — see the plan for the open question of who builds that caller.
type ArtifactGrantIssuer interface {
	// CreateArtifactGrant issues a short-lived, single-use upload grant for
	// one result artifact's bytes.
	CreateArtifactGrant(ctx context.Context, request CreateArtifactGrantRequest) (ArtifactGrant, error)
	// CommitArtifact verifies the bytes uploaded against request.GrantID
	// match request.Artifact exactly (size, media type, digest — the only
	// fields CreateArtifactGrant stored on the grant row; see
	// CommitArtifactRequest's own doc comment for what this does NOT
	// cross-check), then durably records the artifact so a later
	// ArtifactVerifier.VerifyDurable call for the same identity succeeds.
	// An exact retry (identical artifact identity and content, whether
	// replaying the same grant or a fresh one) is idempotent; a
	// conflicting identity reuse returns ErrArtifactGrantConflict.
	CommitArtifact(ctx context.Context, request CommitArtifactRequest) (DurableIndexArtifact, error)
	// ResolveArtifact issues a short-lived, single-use *read* grant for an
	// already-committed artifact's bytes — the read-side counterpart of
	// CreateArtifactGrant, for a consumer that needs the bytes themselves
	// rather than just VerifyDurable's proof of durability.
	ResolveArtifact(ctx context.Context, request ArtifactVerificationRequest) (ArtifactGrant, error)
}
