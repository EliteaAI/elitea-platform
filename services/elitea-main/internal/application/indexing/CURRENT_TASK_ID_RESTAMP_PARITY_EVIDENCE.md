# Current index `task_id` restamp parity

## Current baseline evidence

The current behavior spans two repositories:

- `elitea-sdk/elitea_sdk/tools/base_indexer_toolkit.py:index_meta_init`
  resets `task_id` to `None` on reindex and emits `created_at`/`updated_on`
  through the `index_data_status` callback.
- `centry/pylon_main/plugins/elitea_core/methods/stream.py:
  process_index_data_status_event` invokes the restamp only for
  `agent_index_data_status` with state `in_progress`.
- `centry/pylon_main/plugins/elitea_core/utils/application_tools.py:
  ensure_index_data_has_task_id` loads the index metadata and sets `task_id`
  only when it is missing and the metadata `created_on` equals the callback
  `created_at`.

This is business behavior, not an OpenAPI/toolkit credential rule. It exists so
Stop and a fresh UI session can reconnect the visible in-progress index to the
current execution after the synchronous SDK reset.

## Go/Python parity mapping

| Current behavior | Replatform implementation | Fence |
| --- | --- | --- |
| Select only in-progress index status | `NodeEventFrame.CurrentIndexMetaTaskRestampSource` | Authenticated, exact-generation NodeEvent |
| Resolve target/toolkit/index/task | `persistCurrentIndexMetaTaskRestampIntent` plus `CurrentIndexMetaTaskRestampRepository` | Immutable admitted execution and frozen input bundle; browser identity fields ignored |
| Match current SDK run | `CurrentTaskRestampIndexMeta.CreatedOn` | Exact `created_on`, execution generation, logical index generation and `index_meta_id` |
| Set missing `task_id` | `CurrentIndexMetaWriter.MaterializeTaskID` | Sets only the admitted execution ID |
| Duplicate callback/restart | Immutable per-execution intent and same-task no-op | Idempotent |
| Later reindex | PostgreSQL supersession check plus PgVector generation check | Never overwrites a newer initialized generation |
| Stop/cancel race | PgVector cancelled-state check | Restamp resolves `SUPERSEDED`; cancelled `task_id` remains cleared |

The authenticated NodeEvent transaction performs no Configurations, secret or
PgVector I/O. It appends the bounded replay event and records one small restamp
intent atomically. A separately bounded reconciler claims at most twice its
worker count, redeems only the frozen project configuration, and retries failed
external effects with capped backoff.

`MaterializeTaskID` changes only the root `cmetadata.task_id`; it does not append,
replace, or otherwise rewrite the serialized `history`. The observed Main plus
SDK double-write that can leave an `in_progress` zero-count history entry next
to the completed entry is therefore a separate initialization/SDK ownership
gap. Restamp unit and real-PgVector tests assert that history cardinality and
bytes remain unchanged.

The restamp adds no public authorization surface. It inherits the already
authorized `models.applications.tool.patch` index admission and the exact active
workload claim; it cannot be requested by a viewer, arbitrary project member,
or browser payload. Tenant, resource project and projection project are
rechecked against the admitted execution in the same event transaction.

## Verification boundaries

- Unit/component tests cover event selection, forged browser identity, exact
  admission binding, idempotency, stale `created_on`, stale/newer generation,
  cancelled terminal race, bounded concurrency, retry and supersession.
- The PostgreSQL service-integration test crosses real admission, worker claim,
  authenticated event append, same-transaction intent, tenant rejection,
  durable claim/release/restart/reclaim and resolution.
- The PgVector service-integration test crosses real JSONB/vector tables,
  simulated SDK reset, exact restamp, process-restart retry, stale
  `created_on`, and newer-generation rejection.

## Composition and remaining UI gate

The processor and reconciler are intentionally **not mounted in production
composition in this slice**. Mounting remains gated on the combined
PostgreSQL-to-Configurations-to-PgVector deployment test after this branch is
rebased onto the active migration head. When mounted, the processor must use
`Dependencies.TerminalEffectsPool`, not the output-ingestion pool, so slow
external reconciliation cannot consume output transaction capacity.

Separately, EliteaUI currently has a `sessionStorage` task fallback. A fresh
browser session must be tested without that fallback after the reconciler is
mounted: index metadata alone must reconstruct the active task and Stop must
target the authoritative execution. That UI evidence is not claimed by this
backend slice.
