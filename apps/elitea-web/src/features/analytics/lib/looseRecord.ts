/**
 * Defensive field readers for the analytics API's genuinely-unknown-shaped
 * arrays.
 *
 * `ProjectAnalytics.top_ai_users`/`.daily_activity` and every
 * `AnalyticsDetailEnvelope` sibling array (`users`/`agents`/`tools`) are
 * generated as `zod.array(zod.looseObject({}))` (`x-elitea-passthrough`,
 * see `src/shared/api/generated/model/analyticsDetailEnvelope.zod.ts` /
 * `projectAnalytics.zod.ts`) — the Go handler hardcodes every one of these
 * to `[]any{}` today (`services/elitea-main/internal/api/v2/analytics/
 * handler.go`, all four handlers), so there is no real entry to derive a
 * concrete row type from yet. The baseline SPA's UI nonetheless read
 * specific fields off these rows on the (never-fulfilled) assumption a
 * richer shape would eventually arrive — `user_id`/`user_email`/
 * `llm_calls`/`tool_runs`/`agent_runs`/`ai_events` for the leaderboard,
 * `date`/`events`/`errors`/`users` for the daily-activity points, etc.
 *
 * These helpers preserve that same reading intent (so the UI is forward-
 * compatible the day the backend populates real rows) without asserting a
 * type the schema does not promise: every read is `unknown`-narrowed with
 * an explicit fallback, never a cast.
 */

type LooseRow = Record<string, unknown>;

/** Reads a numeric field, falling back to `fallback` (default `0`) for any non-number value. */
export function numField(row: LooseRow, key: string, fallback = 0): number {
  const value = row[key];
  return typeof value === 'number' ? value : fallback;
}

/** Reads a string field, falling back to `fallback` (default `''`) for any non-string value. */
export function strField(row: LooseRow, key: string, fallback = ''): string {
  const value = row[key];
  return typeof value === 'string' ? value : fallback;
}
