# Index capability v1 to v2 release cutover

This runbook is mandatory for the first release that admits index capability
version `2`. It is a two-stage replacement, not a mixed-version rolling
deployment. The candidate `elitea-main` image ships `/index-v2-preflight` as a
one-shot operator command; the normal image entrypoint remains
`/elitea-main`.

The preflight is observational. It never cancels, retires, deletes, repairs or
reconciles work. A non-zero result means indexing admission stays closed and
operators return to the current durable recovery path.

## Stage A: freeze and drain version 1

1. Close indexing admission at ingress.
2. Keep one `ac96452`-compatible version-`1` Main initializer/outbox publisher
   on the old route and the exact pinned version-`1` worker running. Verify the
   standard migrator's recorded migration head includes
   `0051_index_meta_initialization_recovery.sql`; do not execute its SQL
   manually. That migration marks interrupted pre-authority admissions
   recoverable, but the live Main initializer and outbox publisher must
   materialize and publish them.
3. Recover retryable work or terminally reconcile failed/cancelled work through
   the normal fenced durable state machine. For this rollout, explicitly prove
   execution `4ceb724db45501c2cb9b142422f368db` and every other version-`1`
   execution terminally settle. Never update or delete execution, outbox,
   claim, Redis stream, delivery-index or spool state by hand.
4. Keep the version-`1` worker alive until its Redis deliveries and durable
   output spool are acknowledged, settled and drained. Confirm every
   version-`1` outbox and claim is retired/released and the old Redis
   stream/PEL/delivery index are empty.
5. Only after step 4, scale every version-`1` Main producer to zero and stop
   every version-`1` worker. Preserve and mount every stopped replica's durable
   output-spool root.
6. Run the candidate image's `/index-v2-preflight` against the **old
   version-1** database state, Redis stream and consumer group.
7. Continue only when the command exits `0` and every reported count is zero.
   Exit `1`, exit `2`, a timeout, a missing consumer group, a missing spool
   mount or a dependency error blocks the release.

The check must be rerun after any additional durable reconciliation.

## Dedicated preflight service contract

Use the exact candidate `elitea-main` image and override its entrypoint to
`/index-v2-preflight`. The one-shot service needs no published port and must
not start `/elitea-main`.

Required environment:

| Name | Requirement |
| --- | --- |
| `DATABASE_URL` | Authoritative PostgreSQL URL. Its role needs `SELECT` on `elitea_runtime.execution_jobs`, `elitea_runtime.command_outbox` and `elitea_runtime.execution_claims`. Include the production TLS policy. |
| `ELITEA_RUNTIME_ENABLED` | Exact value `true`. |
| `ELITEA_RUNTIME_INDEX_INGEST_DISPATCH_ENABLED` | Exact value `true`. |
| `ELITEA_RUNTIME_INDEX_INGEST_COMMAND_STREAM` | Old version-`1` dedicated index command stream. |
| `ELITEA_RUNTIME_INDEX_INGEST_CONSUMER_GROUP` | Old version-`1` worker consumer group. |
| `ELITEA_RUNTIME_REDIS_URL` | Canonical `rediss://<acl-user>@<host>:<port>/0` URL without a password. |
| `ELITEA_RUNTIME_REDIS_PASSWORD_FILE` | Absolute in-container path to the old route's Redis ACL password file. |
| `ELITEA_RUNTIME_REDIS_CA_FILE` | Absolute in-container path to the Redis trust anchor. |

The Redis ACL identity needs only the go-redis connection/authentication
handshake (`HELLO`/`AUTH`) plus `PING`, `XLEN`, `XPENDING` and `HLEN` for the
old stream, consumer group and derived delivery-index key. Best-effort client
metadata may be attempted by the library and ignored when denied. The identity
does not need mutation commands.

Required read-only mounts:

- the Redis password file, private and owned by the container identity;
- the Redis CA file;
- PostgreSQL CA/client identity files referenced by `DATABASE_URL`, when its
  TLS mode uses files;
- every old worker replica's durable output-spool root, each passed once as an
  absolute canonical `--spool-root` argument.

The spool directory itself must not be a symlink and must not grant group or
other permissions. Mounting only a shared parent, only currently running
replicas or a newly empty directory is not valid coverage. No runtime command
signing key, worker verification keyring, gRPC listener certificate or server
private key is required by this service and none should be mounted.

Example shape, with deployment-specific secret and volume names:

```yaml
services:
  index-v2-preflight:
    image: <candidate-elitea-main-image>
    entrypoint: ["/index-v2-preflight"]
    command:
      - --spool-root
      - /mnt/index-worker-0/output-spool
      - --spool-root
      - /mnt/index-worker-1/output-spool
    environment:
      DATABASE_URL: <old-release-database-url>
      ELITEA_RUNTIME_ENABLED: "true"
      ELITEA_RUNTIME_INDEX_INGEST_DISPATCH_ENABLED: "true"
      ELITEA_RUNTIME_INDEX_INGEST_COMMAND_STREAM: <old-v1-stream>
      ELITEA_RUNTIME_INDEX_INGEST_CONSUMER_GROUP: <old-v1-group>
      ELITEA_RUNTIME_REDIS_URL: <old-v1-rediss-url>
      ELITEA_RUNTIME_REDIS_PASSWORD_FILE: /run/secrets/runtime-redis-password
      ELITEA_RUNTIME_REDIS_CA_FILE: /run/secrets/runtime-redis-ca.pem
    read_only: true
    volumes:
      - <worker-0-spool>:/mnt/index-worker-0/output-spool:ro
      - <worker-1-spool>:/mnt/index-worker-1/output-spool:ro
```

Centry owns the concrete service composition, secret objects, network policy
and complete replica-specific volume list.

## Stage B: activate version 2

1. Keep indexing admission closed.
2. Deploy all version-`2` workers on a **new** versioned stream and consumer
   group. Verify health and advertised capability version `2`.
3. Deploy version-`2` Main on the same new route and verify health.
4. Reopen indexing admission only after Main and every worker agree on version
   `2`.

Before version-`2` admission reopens, rollback may restore the stopped
version-`1` release on its unchanged old route. After any version-`2` command
is admitted, binary rollback to version `1` is prohibited. Freeze admission,
drain or terminally reconcile version `2`, then roll forward or run a separately
reviewed symmetric cutover. Never attach a version-`1` process to a
version-`2` stream or consumer group. Final version-`2` Main and workers must
reject version-`1` commands; they are not a recovery path for old work.
