/**
 * Where to send a browser that is not logged in.
 *
 * Two authentication planes exist in elitea-main and they are MUTUALLY
 * EXCLUSIVE by construction (`internal/api/production_router.go` mounts one or
 * the other, never both). They expose different entry points, and this module
 * exists because the app previously knew only one of them:
 *
 *   OIDC plane  `/forward-auth/info`, `/forward-auth/auth_oidc/login`
 *   Form plane  `/forward-auth/login` -> `/forward-auth/auth_form/login`
 *
 * The Form plane serves no `/forward-auth/info` at all, so on a Form
 * deployment the session probe 404s, the app concludes "not logged in" — which
 * is right — and then had nowhere to send the user. The measured result was a
 * permanent `<RoutePending />` spinner on every deep link, with the login form
 * one redirect away and nothing performing it.
 *
 * So the plane is INFERRED from the probe rather than configured: a 404 from
 * `/forward-auth/info` means that endpoint is not mounted, which means the Form
 * plane. Anything else means the OIDC plane answered. That keeps a single build
 * of this app correct on both, with no new runtime-config key to set wrong.
 */

/** Form plane. Sets up the transaction, then redirects to the form itself. */
export const FORM_LOGIN_PATH = '/forward-auth/login';

/** OIDC plane. Also used by the re-auth popup (`popup.ts`). */
export const OIDC_LOGIN_PATH = '/forward-auth/auth_oidc/login';

export const TARGET_TO_PARAM = 'target_to';

export type AuthPlane = 'form' | 'oidc';

/**
 * `status` is the HTTP status of the `/forward-auth/info` probe, or undefined
 * when the request never produced one (network failure). Only 404 identifies
 * the Form plane: a 401 is the OIDC plane saying "no session", which is a
 * different answer and must not switch planes.
 */
export function authPlaneFromProbeStatus(status: number | undefined): AuthPlane {
  return status === 404 ? 'form' : 'oidc';
}

export function loginPathForPlane(plane: AuthPlane): string {
  return plane === 'form' ? FORM_LOGIN_PATH : OIDC_LOGIN_PATH;
}

/**
 * Builds the absolute login URL for `plane`, carrying the caller back to
 * `returnTo` afterwards.
 *
 * `returnTo` must be a same-origin absolute path: elitea-main validates it
 * through `browserflow.CanonicalReturnTarget` and silently falls back to the
 * deployment's `default_login` when it is anything else, so an absolute URL
 * here would quietly lose the user's place rather than fail loudly.
 */
export function buildLoginUrl(plane: AuthPlane, returnTo: string): string {
  const target = returnTo.startsWith('/') ? returnTo : `/${returnTo}`;
  return `${loginPathForPlane(plane)}?${TARGET_TO_PARAM}=${encodeURIComponent(target)}`;
}
