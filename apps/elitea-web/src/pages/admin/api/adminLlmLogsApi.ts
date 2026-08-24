/**
 * REST client for the admin LLM Proxy section's **Logs** tab —
 * `GET /api/v2/admin/gateway/logs`.
 *
 * ## The question the Usage tab cannot answer
 *
 * Usage reads `gateway.llm_usage_events`, which is written from the billing
 * delta — and a billing delta rides only a BILLED request. A call refused by a
 * budget, rejected by a policy, addressed to a model that does not resolve, or
 * failed upstream is absent from it. So Usage can say what a deployment spent
 * and can never say what failed.
 *
 * This reads `gateway.llm_request_logs`: one row per request the gateway
 * served, whatever happened to it.
 *
 * ## There is no payload here, and there cannot be
 *
 * No prompt, no completion, no upstream error text — the table has no column
 * any of them could reach. A prompt carries whatever a user pasted into it, and
 * provider errors quote the offending fragment of the request back. The failure
 * field is a CODE the gateway assigns from its own taxonomy.
 *
 * That is worth stating in the UI rather than leaving an operator to discover
 * it: someone who opens a log expecting to read a request needs to know the
 * answer is "reproduce it", not "look harder".
 *
 * ## Paging is by cursor
 *
 * The table is append-mostly and the listing is newest-first, so an offset
 * shifts under the reader — rows arriving between pages push later rows down,
 * and the operator sees duplicates while missing others. The cursor is the
 * row id, carried as a STRING because it is a BIGSERIAL and a JavaScript number
 * would start losing precision silently.
 *
 * Not generated: `orval` builds from `v2.yaml`, which does not describe the
 * admin-panel routes.
 */
import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';
import { unwrapBody } from '@/shared/api/unwrap';

import type { UsageWindow } from './adminLlmProxyApi';

const LOGS_URL = '/admin/gateway/logs';

export interface LlmRequestLogRow {
  /** The cursor. A string because the id is a BIGSERIAL. */
  readonly id: string;
  readonly occurred_at: string;
  readonly project_id: number | null;
  readonly user_id: number | null;
  /** The chi route pattern, never a raw URL. */
  readonly route: string;
  readonly method: string;
  readonly status: number;
  readonly duration_ms: number;
  readonly provider: string;
  readonly model: string;
  readonly streaming: boolean;
  /** The gateway's own classification. Empty on success. */
  readonly error_code: string;
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
}

export interface LlmLogSummary {
  readonly requests: number;
  readonly failed: number;
  /** Median and p95 rather than a mean: a mean over a mix of streamed and
   * buffered responses is dominated by the streams and describes neither. */
  readonly median_ms: number;
  readonly p95_ms: number;
}

export interface LlmLogPage {
  readonly items: readonly LlmRequestLogRow[];
  readonly window: UsageWindow;
  readonly summary: LlmLogSummary;
  /** How many days of log survive the gateway's prune. */
  readonly retention_days: number;
  /** Absent on the last page. */
  readonly next_cursor?: string;
  /** Why the whole page could not be read. */
  readonly error?: string;
  /** Why the window summary could not be computed, when the page could. */
  readonly summary_error?: string;
}

export interface LlmLogFilters {
  readonly window: UsageWindow;
  /** Empty means every project. */
  readonly projectID: string;
  /** Empty means every model. */
  readonly model: string;
  readonly failedOnly: boolean;
}

const EMPTY_SUMMARY: LlmLogSummary = { requests: 0, failed: 0, median_ms: 0, p95_ms: 0 };

const logKeys = {
  page: (filters: LlmLogFilters) =>
    ['admin', 'llmProxy', 'logs', filters.window, filters.projectID, filters.model, filters.failedOnly] as const,
};

/** Fills in what an absent or partial body leaves out. */
function normaliseLogPage(body: LlmLogPage | undefined, window: UsageWindow): LlmLogPage {
  if (body === undefined) {
    return { items: [], window, summary: EMPTY_SUMMARY, retention_days: 0 };
  }
  const base = {
    items: body.items ?? [],
    window: body.window ?? window,
    summary: body.summary ?? EMPTY_SUMMARY,
    retention_days: body.retention_days ?? 0,
  };
  // Each optional field is carried through when present and OMITTED when not.
  // `next_cursor` in particular: an empty string would make the client ask for
  // a page keyed on nothing.
  return {
    ...base,
    ...(body.next_cursor !== undefined ? { next_cursor: body.next_cursor } : {}),
    ...(body.error !== undefined ? { error: body.error } : {}),
    ...(body.summary_error !== undefined ? { summary_error: body.summary_error } : {}),
  };
}

/**
 * `GET /admin/gateway/logs` — one page at a time.
 *
 * An infinite query rather than a paged one: the log is read by scrolling back
 * through time, and a page-number control over a table that grows at the top
 * would renumber itself between clicks.
 */
export function useAdminLlmLogs(
  filters: LlmLogFilters,
): UseInfiniteQueryResult<{ readonly pages: readonly LlmLogPage[] }, Error> {
  return useInfiniteQuery({
    queryKey: logKeys.page(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<LlmLogPage> => {
      const query = new URLSearchParams({ window: filters.window });
      if (filters.projectID !== '') query.set('project_id', filters.projectID);
      if (filters.model !== '') query.set('model', filters.model);
      if (filters.failedOnly) query.set('failed', 'true');
      if (pageParam !== undefined) query.set('cursor', pageParam);

      const body = unwrapBody(await eliteaFetch<unknown>(`${LOGS_URL}?${query.toString()}`)) as
        | LlmLogPage
        | undefined;
      return normaliseLogPage(body, filters.window);
    },
    getNextPageParam: (last) => last.next_cursor,
    // A log is read during an incident. Refetching the FIRST page on an
    // interval keeps the top of the list live without disturbing pages the
    // operator has already scrolled into.
    refetchInterval: 15_000,
  });
}
