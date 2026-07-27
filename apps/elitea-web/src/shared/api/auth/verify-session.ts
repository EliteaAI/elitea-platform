/**
 * Session probe for the auth callback (spec §5.4 behaviour 5).
 *
 * Endpoint binding — `GET /api/v2/social/author/`:
 * the spec asks for "a `GET /api/v2/auth/me`-class call", and the Go router
 * has no literal `/auth/me`; its `/api/v2/auth` mount serves only
 * permissions/token routes (services/elitea-main/internal/api/v2/auth/
 * handler.go:29-31). The auth/me-class endpoint that DOES exist — inside the
 * auth-middleware group (router.go:204-218, the middleware whose genuine 401
 * is middleware/auth.go:155) — is the current-user lookup the old SPA issues
 * at boot: `authorDetails` → `/social/author/`
 * (apps/elitea-ui/src/api/social.js:120-123), served by
 * internal/api/v2/social/handler.go:24 via the mount at router.go:589.
 * A 2xx proves the cookie session authenticates; 401/403/redirect proves it
 * does not.
 */
import type { HttpClient } from '../http';

export const VERIFY_SESSION_PATH = '/social/author/';

/** The narrowed client shape the probe accepts — carries the re-auth flag. */
export type SessionProbeClient = Pick<HttpClient, 'get' | 'reauthConfigured'>;

/**
 * Builds the injectable `verifySession` used by `completeAuthCallback`.
 *
 * The client passed here MUST NOT have `reauthenticate` configured: the probe
 * runs inside the popup's own callback page, so a 401 there means "report
 * failure", never "open another popup" — a re-auth-capable client would spawn
 * a popup from inside a popup and loop. `reauthConfigured` makes that
 * checkable rather than merely documented, and the assertion below fires at
 * construction (a programmer error, so it throws, §3.6).
 */
export function createVerifySession(client: SessionProbeClient): () => Promise<boolean> {
  if (client.reauthConfigured) {
    throw new TypeError(
      'verifySession: the session probe requires a client WITHOUT reauthenticate — a re-auth-capable client would open a re-auth popup from inside the callback popup (§5.4 behaviour 5)',
    );
  }
  return async () => {
    const result = await client.get(VERIFY_SESSION_PATH);
    return result.ok;
  };
}
