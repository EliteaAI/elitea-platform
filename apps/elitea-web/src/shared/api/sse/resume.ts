/**
 * `shared/api/sse/resume.ts` — resuming a dropped execution stream (issue #329).
 *
 * WHY THE CLIENT RESUMES ITSELF INSTEAD OF LETTING `EventSource` DO IT.
 * The WHATWG object only retries after a CLEAN stream end, and it replays by
 * putting the last `id:` it saw in a `Last-Event-ID` REQUEST HEADER. Neither
 * half survives this app's situation:
 *
 *  - Both Go SSE routes answer a rejected stream with an HTTP STATUS (429 with
 *    `Retry-After: 2` from the admission gate, 403, 500, 503). Per spec that
 *    fails the connection permanently — the native retry never runs, which is
 *    exactly the "a dropped connection ends the turn silently" of #329.
 *  - A header cannot be set on a NEW `EventSource` (the constructor takes
 *    `withCredentials` and nothing else), so reopening by hand loses the
 *    native resume entirely.
 *
 * The route anticipates this: `internal/api/v2/executions/events.go`'s
 * `requestedCursor` reads the cursor from `Last-Event-ID` OR from a `cursor`
 * QUERY PARAMETER, and only rejects the pair when both are present and
 * DISAGREE ("conflicting event cursors" → 400). Resuming through the query
 * parameter is therefore the supported path, not a workaround — and because
 * the client closes the failed connection before reopening, the closed object
 * never fires its own native retry, so a header can never appear alongside a
 * stale query cursor and trip that 400.
 */

/**
 * How many times a dropped stream is reopened before the turn is declared
 * lost. Deliberately small and deliberately not "until it works":
 *
 *  - The server's own admission gate caps concurrent streams per principal
 *    and answers 429 when saturated. An unbounded client turns one dead
 *    backend into a retry storm against the gate that is already saying no.
 *  - With the delays below, four attempts span 15 s. A transient drop (a
 *    proxy recycling a connection, a laptop's network flapping) recovers
 *    inside that window; anything that does not is not transient, and a
 *    spinner that never resolves is a worse answer to the user than a stated
 *    "the connection was lost".
 *  - The run is NOT lost when the client gives up — the events are durable
 *    and replayable, so reopening the conversation replays them. The bound
 *    costs a reload, not the answer.
 */
export const MAX_STREAM_RECONNECT_ATTEMPTS = 4;

/** The first backoff step, in ms. */
const BASE_RECONNECT_DELAY_MS = 1_000;
/**
 * The ceiling on one step. Also the total shape: 1 s, 2 s, 4 s, 8 s.
 *
 * The first step is a full second rather than an immediate retry because the
 * most likely rejection is the admission gate, which asks for `Retry-After: 2`
 * — and an `EventSource` error event exposes no status code and no headers, so
 * the client cannot read that hint and must simply not be aggressive.
 */
const MAX_RECONNECT_DELAY_MS = 8_000;

/**
 * The delay before reconnect attempt `attempt` (1-based), or `undefined` once
 * the bound is spent — which is the caller's signal to give up rather than a
 * delay of zero.
 */
export function streamReconnectDelayMs(attempt: number): number | undefined {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_STREAM_RECONNECT_ATTEMPTS) return undefined;
  return Math.min(BASE_RECONNECT_DELAY_MS * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
}

/**
 * The same stream URL, asking the server to replay only what follows `cursor`.
 *
 * A cursor that is not a run of digits is DROPPED rather than forwarded: the
 * route parses it with `strconv.ParseUint` and answers 400 "invalid event
 * cursor" for anything else, so passing junk through would turn a recoverable
 * drop into a permanent failure. No cursor ⇒ the unmodified URL, which the
 * server reads as "from the beginning".
 */
export function withResumeCursor(url: string, cursor: string | null | undefined): string {
  if (!cursor || !/^\d+$/.test(cursor)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}cursor=${cursor}`;
}
