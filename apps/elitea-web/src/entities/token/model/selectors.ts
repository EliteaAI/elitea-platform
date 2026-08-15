import type { PersonalAccessToken } from './types';

const DAY_IN_MILLISECONDS = 24 * 3600 * 1000;

/**
 * apps/elitea-ui/src/common/utils.jsx:691-705 `calculateExpiryInDays`,
 * ported verbatim (`now` is an injected parameter in place of
 * `new Date().getTime()`, to keep this pure): `null` -> `-1` ("never");
 * more than a day left -> rounded whole days; less than a day but still
 * positive -> `1`; non-positive -> `0` ("expired").
 */
export function tokenExpiryInDays(expires: string | null, now: number): number {
  if (expires === null) return -1;
  const duration = new Date(expires).getTime() - now;
  if (duration > DAY_IN_MILLISECONDS) return Math.round(duration / DAY_IN_MILLISECONDS);
  if (duration > 0) return 1;
  return 0;
}

export type TokenExpiryStatus = 'safe' | 'warning' | 'never' | 'expired';

/**
 * apps/elitea-ui/src/[fsd]/features/settings/ui/personal-tokes/
 * TokensTable.jsx:40-119 `ExpiryInDays` — the threshold/status branches
 * extracted as a pure function: `>7` days -> safe; `1-7` days -> warning;
 * `-1` (never) -> never; else (`0`) -> expired.
 */
export function tokenExpiryStatus(expires: string | null, now: number): TokenExpiryStatus {
  const days = tokenExpiryInDays(expires, now);
  if (days > 7) return 'safe';
  if (days > 0) return 'warning';
  if (days === -1) return 'never';
  return 'expired';
}

/**
 * apps/elitea-ui/src/[fsd]/features/settings/ui/personal-tokes/
 * TokensTable.jsx:278-286 — `'...' + row.token.substring(row.token.length - 4)`.
 */
export function maskedTokenValue(token: PersonalAccessToken): string {
  return '...' + token.token.slice(-4);
}

/** Alphabetical name sort — the table's default sort field/direction (`TokensTable.jsx:227-232`). */
export function sortTokensByName(tokens: readonly PersonalAccessToken[]): PersonalAccessToken[] {
  return [...tokens].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/* ── project binding ───────────────────────────────────────────────────── */

/**
 * The bound project as a string key, or `null` when the token is unbound.
 * `undefined` (a record from a backend that predates the binding) and `null`
 * (an explicitly unbound record) collapse to the same answer on purpose —
 * see `PersonalAccessToken.project_id`.
 */
export function tokenProjectKey(token: PersonalAccessToken): string | null {
  const projectId = token.project_id;
  if (projectId === null || projectId === undefined) return null;
  return String(projectId);
}

/**
 * The two failures `POST /api/v2/auth/token/` answers for a bad `project_id`
 * (`spec-llm-project-scope` §4): 403 for a project the caller is not a member
 * of, 400 for a malformed one.
 */
export type TokenProjectErrorCode = 'project_forbidden' | 'invalid_project_id';

function readObject(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

/**
 * Pull the machine-readable code out of a rejected create-token call.
 *
 * TWO ENVELOPE SHAPES REACH THIS FUNCTION, and that is the whole reason it
 * exists. The two project failures use the NESTED shape
 * `{"error":{"message","type","code"}}`, while every other failure on the same
 * endpoint keeps the FLAT shape `{"error":"…"}`. A flat body has a string
 * where this reads an object, so it falls through to `null` and the caller
 * shows its generic message — no throw, no mis-parse.
 *
 * Reads structurally rather than through `instanceof EliteaApiError`: the
 * rejection travels through react-query, and a structural read cannot be
 * defeated by a second copy of the error class in the module graph.
 */
export function tokenProjectErrorCode(error: unknown): TokenProjectErrorCode | null {
  const body = readObject(readObject(error, 'failure'), 'body');
  const code = readObject(readObject(body, 'error'), 'code');
  if (code === 'project_forbidden' || code === 'invalid_project_id') return code;
  return null;
}
