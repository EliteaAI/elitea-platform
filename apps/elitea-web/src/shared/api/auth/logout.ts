/**
 * Complete logout (spec §5.4 behaviour 7).
 *
 * The old logout cleared 2 sessionStorage keys + the Redux user slice
 * (apps/elitea-ui/src/slices/user.js:24-27) and left `elitea_ui.project.id`,
 * `elitea_ui.project.name`, the MCP OAuth tokens (`elitea_mcp_tokens_v1`)
 * and the tour keys behind. The new logout sweeps EVERY key under the `el.`
 * namespace in BOTH storage areas via `clearNamespace()` — completeness is
 * proven by the write-enumeration test in logout.test.ts, not a key list.
 */
import { clearNamespace } from '../../lib/storage';

import { LOGOUT_PATH, OIDC_LOGIN_PATH, TARGET_TO_PARAM } from './constants';

export interface LogoutDeps {
  /** Navigation seam; default assigns `window.location.href`. */
  redirect?: (url: string) => void;
  /** Origin the forward-auth logout URL is built on; default page origin. */
  origin?: string;
}

/**
 * True from the moment `performLogout()` starts until this document dies.
 *
 * MEASURED DEFECT, not a precaution (issue #482). A logout does not end the
 * document: the browser stays on the app page for the whole redirect chain
 * `/forward-auth/logout` → `/forward-auth/auth_oidc/login` → the provider's
 * authorize endpoint. The logout endpoint clears the session cookie on the
 * first hop, so any request the page still has open then answers 401. That
 * 401 reaches `shared/api/http.ts`'s `runReauth()`, which starts a re-auth
 * flight, and the flight writes `el.auth.state` and `el.auth.flight.started`
 * back into sessionStorage — AFTER `clearNamespace()` swept them.
 *
 * Two costs, and the second is the product one:
 *  1. the namespace the logout is contracted to clear is not clear;
 *  2. the user who asked to sign out is shown a sign-in popup.
 *
 * Observed on WebKit, in 2 of 60 runs of end-to-end journey J4, with exactly
 * those two keys surviving. It is a race against the network, so it is rare
 * and it never stops being possible.
 *
 * The flag is module state, not storage: its correct lifetime is exactly the
 * lifetime of the document that starts the logout, and storage would outlive
 * that and would itself be a key in the namespace.
 */
let loggingOut = false;

/** True once `performLogout()` has run in this document. */
export function isLoggingOut(): boolean {
  return loggingOut;
}

/**
 * Clears the entire `el.` namespace (local + session), then hands the browser
 * to the backend logout (old UserButton.jsx:32 preserved:
 * `{origin}/forward-auth/logout`) with the OIDC login entry point as its
 * `target_to`.
 *
 * The `target_to` is what makes JRNY-004's "…and the login screen is reached"
 * true, and it is BEHAVIOURAL parity with the old app rather than a new idea.
 * The old app sent the browser to a bare `/forward-auth/logout` and still
 * arrived at a login screen, because the old deployment gated the SPA at the
 * edge: the post-logout landing (`/` → the app) was itself answered with an
 * OIDC redirect. This stack does not gate `/app/*` at the edge (measured —
 * an unauthenticated browser is served the SPA shell at any deep link), so a
 * bare logout clears the cookie and then parks the signed-out user on the
 * index route's loading state forever. Naming the login endpoint explicitly
 * reproduces the old END STATE on a stack whose edge no longer supplies it,
 * and elitea-main accepts it: it is a same-origin absolute path, which is all
 * `browserflow.CanonicalReturnTarget` requires.
 *
 * Verified against the running E2E stack, as a real browser navigation chain:
 * `/forward-auth/logout?target_to=…` → 302 `/forward-auth/auth_oidc/login`
 * → 302 the provider's `/oauth2/authorize`. (On that stack the last hop then
 * fails DNS, because the issuer is the compose hostname `oidc-mock` which the
 * host browser cannot resolve — the same artifact `e2e/auth.setup.ts` works
 * around by rewriting the hostname. That is a property of the test stack, not
 * of this function.)
 */
export function performLogout(deps: LogoutDeps = {}): void {
  // Set BEFORE the sweep, not after. A flight that starts between the two
  // lines would write its keys after `clearNamespace()` has passed them.
  loggingOut = true;
  clearNamespace();
  const origin = deps.origin ?? window.location.origin;
  const redirect =
    deps.redirect ??
    ((url: string): void => {
      window.location.href = url;
    });
  redirect(
    `${origin}${LOGOUT_PATH}?${TARGET_TO_PARAM}=${encodeURIComponent(OIDC_LOGIN_PATH)}`,
  );
}
