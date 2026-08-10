/**
 * The ONE place a list-shaped API response is unwrapped (R-A6, issue #132).
 *
 * `eliteaFetch` resolves `{data, status, headers}`, so `resp.data` is the
 * response BODY — but the bodies underneath are not uniform. All three of
 * these occur in this API today, measured against the running stack:
 *
 *   - `{rows, total}`            (users, toolkits, tags, participants, …)
 *   - `{items, total, page, page_size, total_pages}`  (messages, configurations, …)
 *   - a bare array               (roles, permissions, …)
 *
 * So the correct expression differs per endpoint, copying a working one to a
 * new call site is actively wrong, and being wrong is SILENT: `undefined` →
 * `[]` → an empty-state render, with a 200 in the network tab and nothing in
 * the console. Four total-failure bugs of exactly that shape were found in a
 * single pass (#132): an empty members table, a roles dropdown that made the
 * invite flow impossible for every user, a once-only PAT rendered blank, and
 * every `/app/chat/:id` deep link hitting the error boundary.
 *
 * Two properties matter more than the convenience:
 *
 *  1. **The fallback is never the input.** `useChatPageData` used to fall back
 *     to the response OBJECT when no branch matched, so an unrecognised shape
 *     became the data and then threw on `[...messageGroups]`. `[]` is the only
 *     legal fallback — an unrecognised shape must never become the data.
 *  2. **An unrecognised shape is loud.** Under DEV/test this throws; in
 *     production it logs and degrades to `[]` (a broken list is not worth a
 *     white screen for a user). Either way the NEXT new envelope surfaces
 *     immediately instead of rendering as "no data".
 *
 * Accepts either the transport envelope (`{data,status,headers}`, i.e. what
 * `eliteaFetch`/react-query hand you) or the bare body, so a call site can
 * never be "one level too deep" or "one level too shallow" again.
 *
 * `elitea/no-adhoc-envelope-unwrap` (R-A6) keeps the hand-rolled forms —
 * `.data.data` chains and `'rows' in x ? …` sniffing — out of the rest of the
 * tree; this module is the rule's one sanctioned path (.oxlintrc.json).
 */

/** @public Result of {@link unwrapListPage} — the rows plus the server's total (falling back to the page length when the body carries no `total`). */
export interface UnwrappedListPage<T> {
  rows: T[];
  total: number;
}

/** The transport envelope `eliteaFetch` builds — see `shared/api/generated/mutator.ts`. */
const ENVELOPE_KEYS = ['data', 'status', 'headers'] as const;

/** List keys, in precedence order. `items` first: it is the paginated envelope, and no measured body carries both. */
const LIST_KEYS = ['items', 'rows'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTransportEnvelope(value: Record<string, unknown>): boolean {
  return ENVELOPE_KEYS.every((key) => key in value);
}

function describe(response: unknown): string {
  if (response === null) return 'null';
  if (Array.isArray(response)) return 'array';
  if (isRecord(response)) return `object with keys [${Object.keys(response).join(', ')}]`;
  return typeof response;
}

/**
 * Loud on an unrecognised shape: throws under DEV/test so it cannot be missed,
 * logs in production so a user gets a broken list rather than a white screen.
 * Both paths end at `[]` — never at `response`.
 */
function reportUnrecognised(response: unknown, context: string): void {
  const message =
    `unwrapList(${context}): unrecognised list response shape — expected an array, {rows}, or {items}, ` +
    // "issue 132" without the leading '#': `elitea/no-raw-color` (R-T1) reads
    // `#132` in a string literal as a raw hex colour literal.
    `got ${describe(response)}. Teach shared/api/unwrap.ts the new envelope instead of unwrapping it ` +
    `ad hoc at the call site (issue 132).`;
  if (import.meta.env.DEV) throw new TypeError(message);
  console.error(message);
}

/**
 * @public Unwraps a list endpoint's response into `{rows, total}`, accepting
 * the `{data,status,headers}` envelope or the bare body, and any of the three
 * body shapes above. Falls back to `{rows: [], total: 0}` — NEVER to the input.
 *
 * @param context Endpoint name, quoted verbatim in the unrecognised-shape
 * diagnostic; make it greppable (e.g. `'userList'`).
 */
export function unwrapListPage<T>(response: unknown, context: string): UnwrappedListPage<T> {
  // The transport envelope is peeled exactly ONCE — deliberately not
  // recursively, so a body that happens to look like an envelope again cannot
  // send this into a loop, and so `{data:{data:…}}` stays an unrecognised
  // shape rather than being silently accepted.
  const body = isRecord(response) && isTransportEnvelope(response) ? response['data'] : response;

  // A not-yet-resolved query is normal, not a shape defect — silent [].
  if (body === undefined || body === null) return { rows: [], total: 0 };

  if (Array.isArray(body)) return { rows: [...(body as T[])], total: body.length };

  if (isRecord(body)) {
    for (const key of LIST_KEYS) {
      const candidate = body[key];
      if (Array.isArray(candidate)) {
        const total = body['total'];
        return { rows: [...(candidate as T[])], total: typeof total === 'number' ? total : candidate.length };
      }
    }
  }

  // `body`, not `response`: after the envelope peel it is the body that failed
  // to match, and naming the envelope's keys would send the reader one level up.
  reportUnrecognised(body, context);
  return { rows: [], total: 0 };
}

/**
 * @public The common case: just the rows. See {@link unwrapListPage} when the
 * server's `total` is needed for pagination.
 */
export function unwrapList<T>(response: unknown, context: string): T[] {
  return unwrapListPage<T>(response, context).rows;
}

/**
 * @public The transport peel on its own, for a body carrying MORE than a list.
 *
 * `unwrapListPage` answers "what are the rows?", which is the whole question
 * for most endpoints. Some bodies carry a sibling the rows do not describe —
 * `/admin/auth_users`'s `{rows, total, counts}`, whose `counts` labels the
 * page's tabs and is deliberately NOT narrowed by the active search. Without
 * this, such a call site has to re-derive `resp.data` by hand, which is exactly
 * the envelope knowledge R-A6 exists to keep out of call sites (added by unit
 * A14 for that reason).
 *
 * Same contract as the list helpers: peels the `{data,status,headers}` envelope
 * exactly ONCE, accepts a bare body unchanged, and returns `undefined` for an
 * unresolved query. It makes no claim about the body's shape — the caller still
 * has to validate what it reads.
 */
export function unwrapBody(response: unknown): unknown {
  return isRecord(response) && isTransportEnvelope(response) ? response['data'] : response;
}
