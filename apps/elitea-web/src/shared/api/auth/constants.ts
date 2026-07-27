/**
 * Auth flow constants + the popup↔opener message contract (spec §5.4).
 * Storage keys are LOGICAL keys — `shared/lib/storage.ts` prefixes them with
 * the `el.` namespace, so a complete logout sweeps them automatically.
 */

export const AUTH_MESSAGE_TYPE = 'elitea-auth-result';
export const AUTH_STATE_PARAM = 'auth_state';
/** sessionStorage (logical): the CSRF state of the in-flight popup flow. */
export const AUTH_STATE_STORAGE_KEY = 'auth.state';
/**
 * localStorage (logical) prefix: cross-window result fallback channel. The
 * key is STATE-SCOPED, exactly like the BroadcastChannel name — with a single
 * shared key two controllers (two tabs) consume each other's result: the
 * loser discards it on state mismatch and its own flight then hangs to
 * `popup_closed`. Still under the `el.` namespace, so logout's sweep clears
 * every scoped key without enumerating states.
 */
const AUTH_RESULT_STORAGE_KEY_PREFIX = 'auth.result.';

export function authResultStorageKey(state: string): string {
  return AUTH_RESULT_STORAGE_KEY_PREFIX + state;
}
export const AUTH_CALLBACK_PATH = '/auth-callback'; // ROUTE-001
export const AUTH_CHANNEL_PREFIX = 'elitea-auth-';
export const LOGOUT_PATH = '/forward-auth/logout'; // old UserButton.jsx:32

export interface AuthResultMessage {
  type: typeof AUTH_MESSAGE_TYPE;
  state: string;
  success: boolean;
}

export function isAuthResultMessage(data: unknown): data is AuthResultMessage {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    record['type'] === AUTH_MESSAGE_TYPE &&
    typeof record['state'] === 'string' &&
    typeof record['success'] === 'boolean'
  );
}
