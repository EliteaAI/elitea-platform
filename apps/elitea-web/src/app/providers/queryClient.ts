import { QueryClient, type DefaultOptions } from '@tanstack/react-query';

import { EliteaApiError } from '@/shared/api/generated/mutator';

/**
 * The HTTP status a rejected query carries, or `undefined` when the rejection
 * is not an ANSWER TO THE REQUEST AS SENT — a network error, an abort, a
 * thrown TypeError, or a `kind: 'auth'` session failure.
 *
 * `kind: 'auth'` IS DELIBERATELY EXCLUDED, and it is the whole reason this
 * function exists apart from `isFinalClientAnswer` below. The two kinds carry
 * a status each, but they answer different questions:
 *
 *  - `kind: 'http'` is the server's verdict on the REQUEST. Its inputs are the
 *    method, the path and the body, and a replay repeats all three.
 *  - `kind: 'auth'` is the server's verdict on the SESSION. `shared/api/
 *    http.ts` only builds one after it ran the single-flight re-authentication
 *    AND replayed the request, and the replay answered 401 as well.
 *
 * A session is not an input the caller controls, and it changes on its own:
 * the user is in the middle of a login the moment this rejection is built. So
 * a later attempt CAN answer differently, which is exactly what
 * {@link isFinalClientAnswer} means by "final" and what a 401 is not.
 */
function httpStatusOf(error: unknown): number | undefined {
  if (!(error instanceof EliteaApiError)) return undefined;
  const { failure } = error;
  return failure.kind === 'http' ? failure.status : undefined;
}

/**
 * `true` when the server has already given its final answer, so repeating the
 * request cannot change it.
 *
 * 408 (Request Timeout) and 429 (Too Many Requests) are excluded: both are 4xx
 * codes that explicitly invite the caller to try again.
 *
 * 501 (Not Implemented) is INCLUDED despite being a 5xx, and it is the one
 * exception to "5xx is transient". The rest of the 5xx range describes a server
 * that failed to do something it does support — a dropped connection, an
 * unhandled panic, an upstream timeout — and a second attempt can genuinely
 * land on a healthy replica. 501 is the server stating that the functionality
 * does not exist here, which is a property of the deployment and not of the
 * attempt. RFC 9110 §15.6.2 puts it exactly that way, and it is the only 5xx
 * the spec describes as a statement about capability rather than about this
 * request's fate.
 *
 * It is not academic. `/elitea_core/analytics*` answers 501 with
 * `{code: "no_data_source"}` on a deployment whose gateway request log is
 * absent — the figures have no producer there and never will until one ships.
 * Treated as transient, each of the four Analytics tabs asked twice: a HAR of
 * one page load against elitea.technicaldomain.xyz holds eight requests, four
 * of them retries of an answer the server had already finished giving, each
 * costing the user a second of backoff before the screen could say anything.
 */
function isFinalClientAnswer(error: unknown): boolean {
  const status = httpStatusOf(error);
  if (status === undefined) return false;
  if (status === 501) return true;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * TanStack Query defaults (spec §2.3 "Server state"; §9.3 unit R2).
 *
 * Pinned version: `@tanstack/react-query@5.101.4` (`@tanstack/query-core`
 * matches). context7's monthly quota was exhausted for this pass, so these
 * defaults were verified directly against the INSTALLED package source for
 * this exact pin rather than against the docs site — arguably a stronger
 * guarantee for a pinned dependency than a docs snapshot:
 *
 *   node_modules/@tanstack/query-core/build/modern/retryer.js:86
 *     `const retry = config.retry ?? (environmentManager.isServer() ? 0 : 3);`
 *   node_modules/@tanstack/query-core/build/modern/retryer.js:8
 *     `Math.min(1e3 * 2 ** failureCount, 3e4)` — the default retryDelay.
 *   node_modules/@tanstack/query-core/build/modern/removable.js:18-21
 *     `this.gcTime = Math.max(this.gcTime || 0, newGcTime ?? (isServer ? Infinity : 5 * 60 * 1e3))`
 *   `staleTime` has no such fallback anywhere in the module — it is `0`
 *   (queries are considered stale immediately after a successful fetch)
 *   whenever `defaultOptions.queries.staleTime` is not set.
 *
 * The values below are a REASONED INFRASTRUCTURE DEFAULT, not a copy of the
 * library default and not parity-derived (the old app used RTK Query, whose
 * cache semantics do not map 1:1 onto TanStack Query's stale/gc model, so
 * there is nothing to port here). Each one is documented individually below.
 * Wave-2 feature hooks may still override per-query where a specific
 * endpoint's freshness or retry needs differ from this baseline.
 */
export const QUERY_DEFAULT_OPTIONS: DefaultOptions = {
  queries: {
    /**
     * 30s, not the library default of 0. At `staleTime: 0`, every remount of
     * a component reading a query key already cached elsewhere in the tree
     * (e.g. navigating between two widgets that both read the current
     * project) triggers an immediate background refetch. 30s is short enough
     * that no screen in this app plausibly shows visibly-wrong data for that
     * long, and long enough to absorb the "read the same thing from two
     * places within a few seconds" pattern that a route change or a
     * multi-widget page produces without a network round trip.
     */
    staleTime: 30_000,
    /**
     * Kept equal to the library default (5 minutes), but pinned explicitly
     * rather than left implicit: an unstated default silently changes
     * behaviour if a future TanStack Query upgrade changes it, and gcTime
     * governs how long an unmounted query's cache entry survives for a
     * fast back-navigation to reuse — 5 minutes is a reasonable width for
     * this app's navigation patterns and is not being second-guessed here.
     */
    gcTime: 5 * 60_000,
    /**
     * 1, not the library default of 3. `shared/api/http.ts` (unit F4) already
     * resolves any 401 through its own single-flight re-auth before a
     * query's promise ever settles (§5.4; a 403 is an authorization refusal
     * and deliberately settles straight away) — by the time a query's promise
     * rejects, F4 has already done everything it can about an auth failure,
     * so a query-level retry only fires for a genuine network error or a
     * non-auth 5xx. The library default's 3 attempts with exponential
     * backoff (~1s + 2s + 4s of waiting, on top of request latency, before
     * the final attempt) delays error UI by several seconds against a truly
     * down endpoint; 1 retry still absorbs a single transient blip without
     * that cost.
     *
     * A PLAIN `retry: 1` STILL REPEATS A 4xx. TanStack Query's retry count
     * applies to every rejection, whatever its cause, so a 403 was requested
     * twice before the screen could show anything. That is measurable: a HAR
     * of one page load against a live deployment holds 32 requests to
     * /api/v2/configurations/configurations/1, all 403, and 10 to
     * /api/v2/configurations/models/1. Half of each set is this retry.
     *
     * A 4xx is the server's final answer to the request as sent. Repeating it
     * byte for byte cannot change the result; it only doubles the load on a
     * failing endpoint and doubles the delay before the user sees the error.
     * Retry now covers exactly what it was reasoned for above: a network
     * error, an abort, a 5xx — and a `kind: 'auth'` session failure.
     *
     * THE RE-AUTHENTICATED 401 IS THE EXCEPTION, and leaving it out cost the
     * app its only recovery. Measured on the E2E stack, journey J3
     * (`e2e/journeys/shell/shell.session.spec.ts`): a 401 mid-session opens
     * the re-auth popup, the user completes a real OIDC round trip, and
     * `http.ts` replays the request the instant the flight resolves — about
     * 10ms BEFORE the popup's `close` event. A replay that lands in that
     * window still answers 401. With a 401 classified as final, every query
     * that failed during the expiry then stayed in its error state for the
     * rest of the page's life: nothing refetches it, `refetchOnWindowFocus`
     * needs a `visibilitychange` the opener never gets, and no other timer
     * exists. The sidebar's Create button reads `usePermissionSet`, so it
     * came back DISABLED after a login the user completed, and only a manual
     * page reload cleared it. Both engines reproduce; webkit lost the race on
     * 3 runs of 3, chromium on 1 of 4.
     *
     * One retry, on the library's 1s backoff, is the recovery. It is bounded
     * — a second `kind: 'auth'` failure ends the query — and it repeats a
     * request the server already refused only when the SESSION, not the
     * request, is what it refused.
     */
    retry: (failureCount: number, error: unknown): boolean => {
      if (isFinalClientAnswer(error)) return false;
      return failureCount < 1;
    },
    /**
     * Kept equal to the library default (`true`), pinned for the same
     * "don't silently inherit" reason as gcTime. Desirable for a
     * dashboard-style app: a user returning to the tab expects the data
     * they're looking at to be current, not to require a manual refresh.
     */
    refetchOnWindowFocus: true,
  },
  mutations: {
    /**
     * 0, deliberately different from the queries default above. A mutation
     * (POST/PUT/DELETE/PATCH) is frequently NOT idempotent, and the decision
     * record's open question ("403 → re-auth replays non-idempotent
     * requests", `decisions-ui-reimplementation-2026-07-26.md`, "Two
     * carry-forward items from F4 verification") is exactly the risk class
     * an automatic mutation-level retry on top of that would compound. A
     * feature's own mutation hook opts into retry explicitly, and only when
     * it has verified the operation is safe to repeat.
     */
    retry: 0,
  },
};

/**
 * Factory, not a module-scope singleton — mirrors F4's `createHttpClient`
 * discipline and the spirit of R-S2 (§3.4), even though R-S2's enforcement
 * mechanism (`elitea/no-module-scope-store`) targets zustand specifically.
 * `AppProviders` constructs exactly one client per mounted tree via a lazy
 * `useState` initializer, so every test's render is cache-isolated and React
 * 19 StrictMode's double-invoke of the initializer never leaks a shared
 * client across trees.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS });
}
