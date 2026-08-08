/**
 * Brand pack delivery channel C (spec §4.3): the per-deployment pack the
 * server publishes at `GET /api/v2/branding/bootstrap.js` as
 * `window.elitea_brand = {…};`.
 *
 * `index.html` loads that script BEFORE the app bundle (a classic blocking
 * `<script src>`, deliberately not `type="module"`/`defer`), so by the time
 * this module's `resolveBrandPack()` runs the global is either populated or
 * the request failed. Both are ordinary outcomes:
 *
 *  - populated and schema-valid → that pack wins, and "a tenant pack swap
 *    reaches the running app with no rebuild" (JRNY-030) is finally true;
 *  - absent (endpoint 404/401/offline, or a dev server with no API proxy) or
 *    schema-invalid → the compiled-in `DEFAULT_BRAND_PACK` (channel A) wins,
 *    which is the same appearance the app had before channel C was wired.
 *
 * Server-side degradation is NOT duplicated here: the Go handler already
 * guarantees it never serves a partial or invalid pack
 * (`internal/api/v2/branding/pack.go` — "a pack is served either exactly as
 * validated or not at all"). This side re-validates anyway, because the
 * global is attacker-reachable in principle (any script that ran earlier
 * could set it) and because the two schemas HAVE drifted before: the served
 * pack was missing `shape.radiusPill`, which the zod schema requires, so
 * every parse failed and channel C degraded silently. The `warn` below is
 * what makes that visible rather than invisible next time.
 *
 * Pure and un-cached on purpose (R-S2: no module-scope mutable state in a
 * file `app/` imports). Callers hold the result — `AppProviders` in a
 * `useState` initializer, `PageTitleSetter` in a `useMemo` — so the parse
 * happens once per mount, not once per render.
 */
import { buildEliteaTheme } from './buildTheme';
import { BrandPack } from './schema';
import { DEFAULT_BRAND_PACK } from './tokens';

/** The global `bootstrap.js` assigns (`renderBootstrapJS`, branding/handler.go). */
export const BRAND_PACK_GLOBAL = 'elitea_brand';

/**
 * Validates a channel-C candidate, falling back to the compiled default pack.
 *
 * @param candidate the raw value read from the global; `undefined` when the
 *   bootstrap script did not run or did not load.
 */
export function parseBrandPack(candidate: unknown): BrandPack {
  if (candidate === undefined || candidate === null) return DEFAULT_BRAND_PACK;
  const parsed = BrandPack.safeParse(candidate);
  if (!parsed.success) {
    return degrade('failed brand-pack validation', parsed.error.issues);
  }
  // Schema-valid is NOT sufficient: `schemes.light`/`schemes.dark` are OPEN
  // records (token id -> colour), so the schema cannot police the id
  // VOCABULARY, and an id that collides with a token GROUP makes
  // `toMuiPalette`'s `unflatten` throw — e.g. a pack stating `"text"` as a
  // leaf when the vocabulary has `text.primary`/`text.secondary`. That throw
  // happens inside the provider's `useMemo`, so it takes down the whole
  // provider tree and the user gets the error boundary instead of the app.
  // MEASURED, not hypothesised: elitea-main's own default pack stated exactly
  // that id, and wiring channel C to the app blanked every screen until it
  // was fixed. A trial build here is what turns "a bad tenant pack breaks the
  // deployment" into "a bad tenant pack is ignored and logged".
  try {
    buildEliteaTheme(parsed.data);
  } catch (cause) {
    return degrade('cannot be built into a theme', cause);
  }
  return parsed.data;
}

/** Logs why channel C was ignored and returns the channel-A floor. */
function degrade(reason: string, detail: unknown): BrandPack {
  // Handled (§3.6): a bad pack must never blank the app — it degrades to
  // channel A, loudly. `console.warn` rather than a thrown error for the same
  // reason the Go handler logs and degrades instead of 500-ing.
  // oxlint-disable-next-line no-console -- deliberate boot-time diagnostic; a SILENT fallback here is exactly the failure mode this module exists to make visible.
  console.warn(
    `brand: window.${BRAND_PACK_GLOBAL} ${reason}; falling back to the compiled default pack`,
    detail,
  );
  return DEFAULT_BRAND_PACK;
}

/** Reads `window.elitea_brand` and validates it. See the module header. */
export function resolveBrandPack(): BrandPack {
  if (typeof window === 'undefined') return DEFAULT_BRAND_PACK;
  return parseBrandPack((window as unknown as Record<string, unknown>)[BRAND_PACK_GLOBAL]);
}
