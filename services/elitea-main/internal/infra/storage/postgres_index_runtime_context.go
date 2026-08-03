package storage

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// AuthorizeRuntimeContext reuses the private content repository's verified
// workload identity and durable claim/session boundary. The resource project
// and actor are selected exclusively by the claimed execution. Agent chat
// execution is interactive in the current contract; scheduled index execution
// retains its existing project-system identity selection.
func (r *PostgresContentRepository) AuthorizeRuntimeContext(
	ctx context.Context,
	claim ContentClaim,
) (RuntimeContextAuthorization, error) {
	workloadID, err := workloadIdentity(claim.PeerCertificate)
	if err != nil {
		return RuntimeContextAuthorization{}, ErrContentUnauthorized
	}

	var authorization RuntimeContextAuthorization
	err = r.store.QueryRow(ctx, `
SELECT j.resource_project_id,
       j.actor_id,
       CASE
           WHEN j.capability_id = 'index.ingest.v1' THEN i.initiator
           WHEN j.capability_id IN (
               'agent.execute.application.v1',
               'agent.execute.adhoc.v1'
           ) THEN 'user'
       END AS initiator
FROM elitea_runtime.execution_claims AS c
JOIN elitea_runtime.execution_jobs AS j
  ON j.execution_id = c.execution_id AND j.generation = c.generation
LEFT JOIN elitea_runtime.index_ingest_jobs AS i
  ON i.execution_id = j.execution_id
 AND i.generation = j.generation
 AND i.capability_id = j.capability_id
LEFT JOIN elitea_runtime.agent_execution_jobs AS a
  ON a.execution_id = j.execution_id
 AND a.generation = j.generation
 AND a.capability_id = j.capability_id
JOIN elitea_runtime.workload_sessions AS ws
  ON ws.workload_session_id = c.workload_session_id
 AND ws.workload_identity = c.workload_identity
 AND ws.producer_id = c.producer_id
WHERE c.claim_id = $1
  AND c.execution_id = $2
  AND c.generation = $3
  AND c.workload_identity = $4
  AND c.fence_token = $5
  AND c.released_at IS NULL
  AND c.lease_expires_at > clock_timestamp()
  AND ws.issued_at <= clock_timestamp()
  AND ws.expires_at > clock_timestamp()
  AND ws.revoked_at IS NULL
  AND j.desired_state = 'RUNNING'
  AND (
      (j.capability_id = 'index.ingest.v1' AND i.execution_id IS NOT NULL)
      OR
      (
          j.capability_id IN (
              'agent.execute.application.v1',
              'agent.execute.adhoc.v1'
          )
          AND a.execution_id IS NOT NULL
      )
  )`,
		claim.ClaimID,
		claim.ExecutionID,
		claim.Generation,
		workloadID,
		claim.FenceToken,
	).Scan(
		&authorization.ResourceProjectID,
		&authorization.ActorID,
		&authorization.Initiator,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return RuntimeContextAuthorization{}, ErrContentUnauthorized
	}
	if err != nil {
		return RuntimeContextAuthorization{}, fmt.Errorf("authorize runtime context: %w", err)
	}
	if authorization.ResourceProjectID <= 0 {
		return RuntimeContextAuthorization{}, errors.New("authorize runtime context: invalid project")
	}
	if authorization.ActorID == "" || authorization.Initiator == "" {
		return RuntimeContextAuthorization{}, errors.New("authorize runtime context: invalid execution identity")
	}
	return authorization, nil
}

var _ RuntimeContextAuthorizer = (*PostgresContentRepository)(nil)
