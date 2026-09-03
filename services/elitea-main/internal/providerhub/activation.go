package providerhub

// ACTIVATION — the half of the admission plane 0107 deliberately could not
// reach (ADR-0012 phase P3, migration 0109).
//
// 0107 wrote "a missing overlay policy fails admission" as a CHECK constraint
// and then had no way to satisfy it, so every revision this deployment recorded
// stayed `inactive` for want of an issuer. store.go's InactiveReason says so in
// the row itself. This file is the issuer.
//
// WHAT AN ACTIVATION IS, AND WHY IT TAKES A DIGEST. An operator reads a
// published manifest, decides what its tools may do, and records those reviewed
// facts as an overlay. The overlay is about THOSE BYTES. So activation is a
// compare-and-swap against the manifest digest: if the provider republished
// between the review and the click, the revision now cites bytes nobody looked
// at, and putting a reviewed policy in force over them would be worse than
// refusing. `expected_digest` is what makes the refusal possible.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The typed outcomes. Each is a DIFFERENT thing for an operator to do about
// it, which is why they are distinguished here rather than at the HTTP
// boundary: "you named a provider nobody registered", "somebody else got there
// first", and "the manifest moved under you" are three separate problems and
// one status code for all three would send every one of them to the same
// unhelpful place.
var (
	// ErrNoAdmittedRevision — an origin exists but no revision does.
	// Registration files one, so this is a facade that has never completed a
	// boot registration.
	ErrNoAdmittedRevision = errors.New("no admitted revision exists for this provider")

	// ErrManifestDigestMismatch — the caller's expected_digest is not the
	// digest the revision cites. See the file header: this is the whole reason
	// activation carries a digest.
	ErrManifestDigestMismatch = errors.New("the revision's manifest digest is not the one expected")

	// ErrRevisionNotInactive — the revision is already active, or it is
	// revoked. A REVOKED REVISION IS NEVER RE-ACTIVATED: a revocation is a
	// decision about those bytes, and undoing it means admitting them afresh
	// through the registration path, which leaves the revocation on the record
	// where an audit can still read it.
	ErrRevisionNotInactive = errors.New("only an inactive revision can be activated")

	// ErrAnotherRevisionActive — 0107's partial unique index refused. Another
	// revision of the same provider is already active in this project.
	ErrAnotherRevisionActive = errors.New("another revision of this provider is already active")

	// ErrNoActiveRevision — a deactivate found nothing in force to turn off.
	ErrNoActiveRevision = errors.New("no active revision exists for this provider")

	// ErrProviderNotRegistered — no origin row at all. Usually a misspelt
	// provider name.
	ErrProviderNotRegistered = errors.New("provider is not registered for this project")

	// ErrOverlayPlaneAbsent — migration 0109 has not been applied, so there is
	// no overlay table to issue into. Told apart from a failed query the way
	// Present tells 0107 apart from one: an unapplied migration is a state the
	// caller can explain, and a 500 tells an operator nothing about which
	// migration is missing.
	ErrOverlayPlaneAbsent = errors.New("the policy overlay plane is absent (migration 0109)")
)

// ActivateRequest is one activation.
type ActivateRequest struct {
	ProjectID  int64
	ProviderID string

	// RevisionID names the revision to activate. Empty means "the latest",
	// which is what the administration page sends: it shows one row per
	// provider and the operator is acting on what that row displays.
	RevisionID string

	// ExpectedDigest is the manifest the operator reviewed. Required.
	ExpectedDigest string

	// Body is the reviewed policy overlay: a JSON object, and a small one in
	// v1. Migration 0109 pins no schema for it — see that file's header for
	// why a column shape frozen now would be a drifting second copy of a
	// schema still being written.
	Body []byte

	// Reason is the operator's sentence, recorded on the revision row.
	Reason string

	// Actor is who acted. Recorded as BOTH created_by and approved_by: the
	// specification's creator-≠-approver rule is recorded, not enforced, in v1
	// so that a single-operator deployment can activate at all. Migration
	// 0109's header carries the decision.
	Actor string
}

// Activated is what an activation produced.
type Activated struct {
	RevisionID      string
	OverlayRevision string
	ManifestDigest  string
	Status          string
	Reason          string
}

// OverlayPlanePresent reports whether migration 0109 has been applied.
// to_regclass answers NULL for a name that does not resolve, without raising.
func OverlayPlanePresent(ctx context.Context, pool *pgxpool.Pool) bool {
	if pool == nil {
		return false
	}
	var present bool
	if err := pool.QueryRow(ctx,
		`SELECT to_regclass('provider_hub.provider_policy_overlay') IS NOT NULL`,
	).Scan(&present); err != nil {
		return false
	}
	return present
}

// CanonicalOverlay is the byte form an overlay is digested over.
//
// The body is round-tripped through Go's JSON decoder and encoder, which sorts
// object keys and drops insignificant whitespace, so two reviewers who recorded
// the same facts in a different order issue ONE overlay revision. That is what
// makes a content-derived id meaningful rather than decorative.
//
// THIS IS NOT THE MANIFEST'S RULE, and the difference is deliberate.
// provider_published_manifest stores raw bytes precisely because its digest
// must be over what the PROVIDER published, and a round trip through jsonb
// would not re-digest to the same value. An overlay is authored here, so its
// canonical form is ours to define.
//
// An absent or empty body canonicalises to `{}` rather than failing: v1 permits
// an overlay that records only a reason, and the reason lives on the revision.
func CanonicalOverlay(body []byte) ([]byte, error) {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return []byte("{}"), nil
	}
	var decoded map[string]any
	if err := json.Unmarshal(trimmed, &decoded); err != nil {
		return nil, fmt.Errorf("the overlay must be a JSON object: %w", err)
	}
	if decoded == nil {
		return []byte("{}"), nil
	}
	canonical, err := json.Marshal(decoded)
	if err != nil {
		return nil, fmt.Errorf("canonicalise the overlay: %w", err)
	}
	return canonical, nil
}

// OverlayRevisionID derives the id from the overlay's digest: migration 0109's
// `'lpo_' || left(sha256(canonical body), 32)`. A CHECK there re-derives it
// from the stored digest column, so this spelling and the migration's cannot
// drift apart without the insert failing.
func OverlayRevisionID(digest string) string {
	return "lpo_" + digest[:32]
}

// Activate issues a policy overlay and puts one admitted revision in force, in
// ONE transaction.
//
// The ORDER is not arbitrary. The overlay is written first because the
// revision's FOREIGN KEY (0109) requires the row to exist and its CHECK (0107)
// requires the reference to be non-NULL the instant the status becomes
// 'active'. So there is no window — not even inside the transaction — in which
// an active revision names an overlay that is not there.
//
// The UPDATE is a COMPARE-AND-SWAP on both the status and the manifest digest.
// Reading the row and then writing it would be a check followed by a write with
// a gap between them, and the gap is exactly where a concurrent revoke, or a
// re-registration that published new bytes, lands.
func Activate(ctx context.Context, pool *pgxpool.Pool, in ActivateRequest) (Activated, error) {
	canonical, err := CanonicalOverlay(in.Body)
	if err != nil {
		return Activated{}, err
	}
	overlayDigest := Digest(canonical)
	overlayRevision := OverlayRevisionID(overlayDigest)

	tx, err := pool.Begin(ctx)
	if err != nil {
		return Activated{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	revisionID, manifestDigest, status, err := lockTargetRevision(ctx, tx, in)
	if err != nil {
		return Activated{}, err
	}
	// The DIGEST check comes before the STATUS check on purpose. An operator
	// whose manifest moved under them needs to be told that, not that the row
	// they were looking at is in an unexpected state — the second message
	// sends them to reload the page, and the page would show the same thing.
	if manifestDigest != in.ExpectedDigest {
		return Activated{}, fmt.Errorf("%w: the revision cites %s and the caller expected %s",
			ErrManifestDigestMismatch, manifestDigest, in.ExpectedDigest)
	}
	if status != "inactive" {
		return Activated{}, fmt.Errorf("%w: the revision is %s", ErrRevisionNotInactive, status)
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO provider_hub.provider_policy_overlay
  (overlay_revision, project_id, provider_id, manifest_digest, body, digest, created_by, approved_by)
VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $7)
ON CONFLICT (overlay_revision) DO NOTHING`,
		overlayRevision, in.ProjectID, in.ProviderID, manifestDigest,
		string(canonical), overlayDigest, in.Actor); err != nil {
		if overlayPlaneMissing(err) {
			return Activated{}, ErrOverlayPlaneAbsent
		}
		return Activated{}, fmt.Errorf("issue overlay: %w", err)
	}

	tag, err := tx.Exec(ctx, `
UPDATE provider_hub.provider_admitted_revision
   SET status = 'active',
       overlay_revision = $1,
       reason = $2
 WHERE revision_id = $3
   AND status = 'inactive'
   AND manifest_digest = $4`,
		overlayRevision, in.Reason, revisionID, in.ExpectedDigest)
	if err != nil {
		if isUniqueViolation(err) {
			// 0107's partial unique index: ONE active revision per provider per
			// project. Two would make "which manifest is this deployment
			// running" unanswerable, which is why it is an index and not a rule
			// in Go that a second code path could forget.
			return Activated{}, ErrAnotherRevisionActive
		}
		return Activated{}, fmt.Errorf("activate revision: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// The row was read and locked inside this transaction, so a CAS that
		// affects nothing means the caller supplied a revision id that another
		// transaction moved out from under this one.
		return Activated{}, ErrRevisionNotInactive
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return Activated{}, ErrAnotherRevisionActive
		}
		return Activated{}, fmt.Errorf("commit: %w", err)
	}
	return Activated{
		RevisionID:      revisionID,
		OverlayRevision: overlayRevision,
		ManifestDigest:  manifestDigest,
		Status:          "active",
		Reason:          in.Reason,
	}, nil
}

// lockTargetRevision picks the revision an activation acts on and holds it for
// the transaction. The ACTIVE revision first, as LatestAdmission orders: a
// deactivate must find the row in force, and an activate beside one must
// meet it (and refuse) rather than a newer inactive row the registrar
// re-filed, which would have put two revisions in force. FOR UPDATE, so two operators clicking Activate in the same
// instant serialise here rather than both reaching the CAS and one of them
// meeting a raw 23505.
func lockTargetRevision(ctx context.Context, tx pgx.Tx, in ActivateRequest) (
	revisionID string, manifestDigest string, status string, err error,
) {
	err = tx.QueryRow(ctx, `
SELECT revision_id, manifest_digest, status
  FROM provider_hub.provider_admitted_revision
 WHERE project_id = $1 AND provider_id = $2
   AND ($3 = '' OR revision_id = $3)
 ORDER BY (status = 'active') DESC, admitted_at DESC, (status = 'revoked') DESC, revision_id DESC
 LIMIT 1
   FOR UPDATE`, in.ProjectID, in.ProviderID, in.RevisionID).
		Scan(&revisionID, &manifestDigest, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		// Told apart, because they are different mistakes: a provider nobody
		// registered is usually a misspelt name, while a registered provider
		// with no revision is a facade that has not finished booting.
		var registered bool
		if probeErr := tx.QueryRow(ctx, `
SELECT EXISTS (SELECT 1 FROM provider_hub.provider_origin_registration
                WHERE project_id = $1 AND provider_id = $2)`,
			in.ProjectID, in.ProviderID).Scan(&registered); probeErr != nil {
			return "", "", "", fmt.Errorf("check registration: %w", probeErr)
		}
		if !registered {
			return "", "", "", ErrProviderNotRegistered
		}
		return "", "", "", ErrNoAdmittedRevision
	}
	if err != nil {
		return "", "", "", fmt.Errorf("read revision: %w", err)
	}
	return revisionID, manifestDigest, status, nil
}

// Deactivate returns an active revision to `inactive`, KEEPING its overlay
// reference.
//
// 0107's constraint is `status <> 'active' OR overlay_revision IS NOT NULL`. It
// constrains the ACTIVE state only, so an inactive row may carry an overlay and
// nothing has to be NULLed. Keeping it is the better answer and not merely the
// permitted one: the overlay records which policy this provider was last put in
// force under, and clearing it on the way out would erase that from the very row
// an operator reads when they ask what it was running. A later Activate issues
// (or reuses, by digest) an overlay of its own, so nothing but a reader depends
// on the retained reference.
//
// DEACTIVATE IS NOT REVOKE. Revoke is terminal and records revoked_at/by;
// deactivate returns the revision to the state registration left it in, so it
// can be activated again without republishing.
//
// IT TAKES NO ACTOR, and the omission is stated rather than quietly convenient.
// 0107 has revoked_at/revoked_by and no deactivated_at/by, and inventing a
// column for one verb would put a second, partial actor trail beside the one
// that already exists. WHO deactivated is recorded where every other
// administrative action is: centry.audit_events, through the audited
// register_descriptor prefix, with the principal, the route and the time. The
// row itself keeps the operator SENTENCE, which is the part a reader of the row
// needs.
func Deactivate(ctx context.Context, pool *pgxpool.Pool, projectID int64, providerID, reason string) error {
	tag, err := pool.Exec(ctx, `
UPDATE provider_hub.provider_admitted_revision
   SET status = 'inactive', reason = $3
 WHERE project_id = $1 AND provider_id = $2 AND status = 'active'`,
		projectID, providerID, reason)
	if err != nil {
		return fmt.Errorf("deactivate revision: %w", err)
	}
	if tag.RowsAffected() > 0 {
		return nil
	}
	var registered bool
	if err := pool.QueryRow(ctx, `
SELECT EXISTS (SELECT 1 FROM provider_hub.provider_origin_registration
                WHERE project_id = $1 AND provider_id = $2)`,
		projectID, providerID).Scan(&registered); err != nil {
		return fmt.Errorf("check registration: %w", err)
	}
	if !registered {
		return ErrProviderNotRegistered
	}
	return ErrNoActiveRevision
}

// isUniqueViolation reports SQLSTATE 23505.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// overlayPlaneMissing reports SQLSTATE 42P01, undefined_table. A deployment
// that ran 0107 but not 0109 has revisions and no overlay table, and that is a
// migration state rather than a failure.
func overlayPlaneMissing(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
}
