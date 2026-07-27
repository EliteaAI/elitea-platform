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
