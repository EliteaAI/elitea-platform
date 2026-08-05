/**
 * Token domain type — a personal access token. No OpenAPI schema exists for
 * this resource (settings domain, not in the W2 manifest).
 *
 * Evidence: apps/elitea-ui/src/api/auth.js:51-77 — `tokenList` (GET, the
 * FULL token value is present in the list response — the old app truncates
 * for display, it does not withhold the value server-side, see
 * `TokensTable.jsx:284` `row.token.substring(row.token.length - 4)`);
 * `tokenCreate` (POST, body `{name, expires}`); `tokenDelete` (DELETE
 * `{uuid}`). apps/elitea-ui/src/common/constants.js:476-477 —
 * `DEFAULT_TOKEN_EXPIRATION_DAYS = 30`,
 * `EXPIRATION_MEASURES = ['never','days','weeks','hours','minutes']`.
 *
 * Two distinct `expires` shapes exist — do not conflate them:
 * - the CREATE-REQUEST body's `expires` is `null` ("never") or
 *   `{measure, value}` (`CreatePersonalToken.jsx:43-47`) — the Go backend
 *   resolves this into an absolute expiry server-side;
 * - the PERSISTED token record's `expires` (as returned by `tokenList`) is
 *   a date string or `null`, confirmed by `TokensTable.jsx:38-40` passing
 *   `row.expires` straight into `calculateExpiryInDays`
 *   (apps/elitea-ui/src/common/utils.jsx:691-705), which does
 *   `new Date(expiration).getTime()`.
 */
type TokenExpirationMeasure = 'days' | 'weeks' | 'hours' | 'minutes';

/** The CREATE-REQUEST `expires` shape. `null` means "never expires". */
export type TokenExpirationRequest = null | { readonly measure: TokenExpirationMeasure; readonly value: number };

export interface PersonalAccessToken {
  readonly uuid: string;
  readonly name: string;
  /** The full token value, as returned by the API — masking is a display concern (see selectors). */
  readonly token: string;
  /** ISO 8601 date-time, or `null` for "never expires". */
  readonly expires: string | null;
}
