/**
 * Index domain type — a datasource search-index entity (toolkit-scoped,
 * e.g. a vector index over a repo/confluence space). No OpenAPI schema
 * exists for this resource (chat/agent-authoring domain, not in the W2
 * manifest).
 *
 * Evidence: apps/elitea-ui/src/[fsd]/features/toolkits/indexes/api/
 * indexesApi.js:12-46 (`getIndexesList` GET
 * `elitea_core/index_meta/prompt_lib/{projectId}/{toolkitId}`, returns a raw
 * array); apps/elitea-ui/src/[fsd]/features/toolkits/indexes/lib/constants/
 * indexDetails.constants.js:22-40 (`IndexStatuses` enum,
 * `IndexHistoryItemsLabels`); apps/elitea-ui/src/[fsd]/features/toolkits/
 * indexes/ui/IndexListItem.jsx:20-87 (field usage:
 * `metadata.{collection,state,indexed,updated,history,skipped,created_on,
 * task_id,conversation_id}`, top-level `id`/`stale`).
 */

/** `IndexStatuses` — indexDetails.constants.js:22-29. */
export type IndexStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'created' | 'partly_indexed';

export interface IndexHistoryEntry {
  readonly state: IndexStatus;
  readonly timestamp?: string;
}

export interface IndexMetadata {
  /** The index name — shown as title, matched against the `index_name` URL param. */
  readonly collection: string;
  readonly state: IndexStatus;
  readonly indexed?: number;
  readonly updated?: number;
  readonly history?: readonly IndexHistoryEntry[];
  /** Either a numeric count or `{ total_skipped }`, both observed on the wire. */
  readonly skipped?: number | { readonly totalSkipped: number };
  /** Unix seconds. */
  readonly createdOn?: number;
  readonly taskId?: string;
  /** Attached client-side by the socket handler once indexing starts. */
  readonly conversationId?: string;
}

export interface IndexItem {
  readonly id: string;
  readonly metadata: IndexMetadata;
  /** Client-derived: true when the item's status needs a refresh nudge. */
  readonly stale?: boolean;
}

/**
 * Per-user reindex schedule, nested under the OWNING TOOLKIT's
 * `meta.indexes_meta[indexName].schedules[userId]` — see `lib/normalise.ts`
 * for the flattening this type is the OUTPUT of.
 */
export interface IndexSchedule {
  readonly cron: string;
  readonly enabled: boolean;
  readonly credentials: string | null;
}
