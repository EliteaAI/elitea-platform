// Package providerhub is the admission plane's storage (ADR-0012 phase P3,
// migration 0107): the writes both the administration surface and the
// facades' boot-time registrar make, in one place, so the two cannot
// disagree about what a registration is.
//
// Four tables, and the split is the design: WHO may be reached
// (provider_origin_registration, mutable), WHAT was published
// (provider_published_manifest, content-addressed and insert-only), WHAT
// THIS DEPLOYMENT ADMITS (provider_admitted_revision, a lifecycle), and
// WHETHER IT ANSWERED LAST TIME ANYONE ASKED (provider_health_projection —
// a projection with an observed_at, not a property).
package providerhub

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InactiveReason is recorded on every admitted revision this deployment
// writes: admission is recorded, not in force, until a policy overlay can
// activate it.
const InactiveReason = "recorded, not in force: activating a provider requires a policy " +
	"overlay, and this deployment cannot issue one yet (ADR-0012 phase P3). The descriptor is stored " +
	"and visible, and no agent can call this provider's toolkits."

// Registration is one provider's origin and manifest for one project.
type Registration struct {
	ProjectID  int64
	ProviderID string
	// Origin is the reviewed service location: scheme, host and port, no path.
	Origin string
	// Manifest is the descriptor document as published, byte for byte.
	Manifest []byte
	// Actor is who registered: an operator's email, or a facade's name.
	Actor string
}

// Admitted is what a registration produced.
type Admitted struct {
	RevisionID     string
	ManifestDigest string
	Status         string
	Reason         string
}

// Present reports whether migration 0107 has been applied — to_regclass
// answers NULL for a name that does not resolve, without raising.
func Present(ctx context.Context, pool *pgxpool.Pool) bool {
	var present bool
	if err := pool.QueryRow(ctx,
		`SELECT to_regclass('provider_hub.provider_admitted_revision') IS NOT NULL`,
	).Scan(&present); err != nil {
		return false
	}
	return present
}

// Digest is the manifest's content address.
func Digest(manifest []byte) string {
	sum := sha256.Sum256(manifest)
	return hex.EncodeToString(sum[:])
}

// Register records the origin (upsert), publishes the manifest (insert-only
// by digest) and admits the revision as inactive, in one transaction. The
// same bytes registered twice are one manifest row and one revision row
// with a refreshed admitted_at.
func Register(ctx context.Context, pool *pgxpool.Pool, in Registration) (Admitted, error) {
	digest := Digest(in.Manifest)
	revisionID := fmt.Sprintf("%d:%s:%s", in.ProjectID, in.ProviderID, digest[:16])
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Admitted{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if _, err := tx.Exec(ctx, `
INSERT INTO provider_hub.provider_origin_registration
  (project_id, provider_id, origin, registered_by)
VALUES ($1, $2, $3, $4)
ON CONFLICT (project_id, provider_id) DO UPDATE
   SET origin = EXCLUDED.origin,
       registered_at = clock_timestamp(),
       registered_by = EXCLUDED.registered_by`,
		in.ProjectID, in.ProviderID, in.Origin, in.Actor); err != nil {
		return Admitted{}, fmt.Errorf("register origin: %w", err)
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO provider_hub.provider_published_manifest (digest, manifest_bytes)
VALUES ($1, $2)
ON CONFLICT (digest) DO NOTHING`, digest, in.Manifest); err != nil {
		return Admitted{}, fmt.Errorf("publish manifest: %w", err)
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO provider_hub.provider_admitted_revision
  (revision_id, project_id, provider_id, manifest_digest, status, reason, admitted_by)
VALUES ($1, $2, $3, $4, 'inactive', $5, $6)
ON CONFLICT (revision_id) DO UPDATE
   SET reason = EXCLUDED.reason, admitted_at = clock_timestamp()`,
		revisionID, in.ProjectID, in.ProviderID, digest, InactiveReason, in.Actor); err != nil {
		return Admitted{}, fmt.Errorf("admit revision: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Admitted{}, fmt.Errorf("commit: %w", err)
	}
	return Admitted{RevisionID: revisionID, ManifestDigest: digest, Status: "inactive", Reason: InactiveReason}, nil
}

// LatestAdmission reads the admission a request path must obey: the most
// recently admitted revision for one (project, provider), or false when
// nobody has admitted one.
//
// NOT FOUND IS NOT AN ERROR, and the distinction is the whole reason for the
// bool. A provider whose facade has not finished its first registration has
// no revision row, and that is a normal state seconds after a boot — a
// caller that could not tell it from a failed query would have to choose
// between refusing every early request and ignoring real failures.
//
// THE TIE-BREAK ORDERS TOWARDS REFUSAL. Revoking does not touch admitted_at
// (a revocation is a fact about a revision, not a new admission), so two
// rows admitted inside the same clock tick could otherwise be read in
// either order. `revoked` sorts first among equals, so the ambiguous case
// resolves to the closed answer rather than to whichever row the planner
// happened to return.
func LatestAdmission(ctx context.Context, pool *pgxpool.Pool, projectID int64, providerID string) (Admitted, bool, error) {
	var latest Admitted
	err := pool.QueryRow(ctx, `
SELECT revision_id, manifest_digest, status, reason
  FROM provider_hub.provider_admitted_revision
 WHERE project_id = $1 AND provider_id = $2
 ORDER BY admitted_at DESC, (status = 'revoked') DESC, revision_id DESC
 LIMIT 1`, projectID, providerID).
		Scan(&latest.RevisionID, &latest.ManifestDigest, &latest.Status, &latest.Reason)
	if errors.Is(err, pgx.ErrNoRows) {
		return Admitted{}, false, nil
	}
	if err != nil {
		return Admitted{}, false, fmt.Errorf("latest admission: %w", err)
	}
	return latest, true, nil
}

// RecordHealth overwrites the projection for one (project, provider) with
// what a probe just saw. The row must be registered first — the projection
// references the origin — so a probe of an unregistered provider is an
// error, not a silent row.
func RecordHealth(ctx context.Context, pool *pgxpool.Pool, projectID int64, providerID string, healthy bool, detail string) error {
	_, err := pool.Exec(ctx, `
INSERT INTO provider_hub.provider_health_projection (project_id, provider_id, healthy, observed_at, detail)
VALUES ($1, $2, $3, clock_timestamp(), $4)
ON CONFLICT (project_id, provider_id) DO UPDATE
   SET healthy = EXCLUDED.healthy,
       observed_at = clock_timestamp(),
       detail = EXCLUDED.detail`,
		projectID, providerID, healthy, detail)
	if err != nil {
		return fmt.Errorf("record health: %w", err)
	}
	return nil
}
