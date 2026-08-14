import { QueryClient, type DefaultOptions } from '@tanstack/react-query';

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
     */
    retry: 1,
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
