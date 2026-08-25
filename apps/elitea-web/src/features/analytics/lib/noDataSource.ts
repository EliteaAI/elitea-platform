import { EliteaApiError } from '@/shared/api/generated/mutator';

/**
 * Tells the two things the analytics endpoints can fail with apart.
 *
 * They are NOT the same event and the screen must not say the same thing about
 * both:
 *
 *  - A QUERY FAILURE (500, a dropped connection, a timeout) is transient. The
 *    data exists; this attempt did not reach it. "Failed to load analytics
 *    data." is true, and retrying is sensible.
 *  - AN ABSENT DATA SOURCE (501 `{code: "no_data_source"}`) is permanent on
 *    this deployment. Nothing in the platform produces the figures the tab
 *    wants, and no amount of retrying or reloading will change that.
 *    `internal/api/v2/analytics/handler.go`'s writeRepoFailure is the one
 *    place that decides which of the two a caller is looking at.
 *
 * Rendering the second as the first is what the Analytics page did: a user
 * looking at "Failed to load analytics data." on all four tabs has no way to
 * know that three of them are working exactly as designed, and reasonably
 * files a bug or waits for a fix that is not coming. The backend already sends
 * the distinction — and a human-readable reason with it — so the screen's job
 * is to stop discarding it.
 *
 * The check is on the STATUS plus a machine-readable `code`, never on the
 * prose: an error message is for the operator reading the network tab, and a
 * screen that branches on it breaks the day somebody rewords it.
 */
export interface NoDataSource {
  /**
   * The server's own explanation of what is missing and why, e.g. "tool
   * analytics: p_<id>.chat_message_trace_step records tool_name but no
   * toolkit_id, and covers chat turns only". Empty when the response carried
   * no detail.
   */
  readonly detail: string;
}

interface NoDataSourceBody {
  readonly code?: unknown;
  readonly detail?: unknown;
}

export function noDataSourceOf(error: unknown): NoDataSource | undefined {
  if (!(error instanceof EliteaApiError)) return undefined;
  const { failure } = error;
  if (failure.kind !== 'http' || failure.status !== 501) return undefined;

  // The body is `unknown` by construction — `http.ts` parses it without
  // asserting a shape — so this narrows rather than casts.
  //
  // A 501 that is NOT this refusal falls through to `undefined`, and the screen
  // shows the generic failure. That covers a proxy's HTML error page and any
  // future 501 this platform grows for an unrelated reason: both are permanent,
  // but only the one carrying `code: "no_data_source"` is a statement about the
  // analytics data source, and only for that one can the screen honestly say
  // which figure is missing and why. Claiming the stronger thing on a status
  // code alone would put "not available on this deployment" under a gateway's
  // 501.
  const body: NoDataSourceBody = typeof failure.body === 'object' && failure.body !== null ? failure.body : {};
  if (body.code !== 'no_data_source') return undefined;
  return { detail: typeof body.detail === 'string' ? body.detail : '' };
}
