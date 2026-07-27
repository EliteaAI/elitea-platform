/**
 * Auth-callback logic (spec §5.4 behaviour 5).
 *
 * The old `AuthCallbackPage` posted `success: true` UNCONDITIONALLY on
 * reaching the page (apps/elitea-ui/src/[fsd]/pages/auth/index.jsx:42-46) —
 * reaching the callback URL proves nothing about the session. The new
 * callback confirms a session actually exists with an injected
 * `verifySession()` (an auth/me-class GET — see auth/verify-session.ts for
 * the endpoint binding) and posts failure when it does not.
 *
 * Result delivery ports auth.helpers.js `sendAuthResult`: opener
 * postMessage + BroadcastChannel + localStorage fallback (via the
 * namespaced storage wrapper, so logout sweeps it).
 */
import { createStorage } from '../../lib/storage';

import { createBroadcastChannel } from './channel';
import type { AuthChannelLike } from './channel';
import {
  AUTH_CHANNEL_PREFIX,
  AUTH_MESSAGE_TYPE,
  AUTH_STATE_PARAM,
  authResultStorageKey,
} from './constants';
import type { AuthResultMessage } from './constants';

/** @public Wave-1 surface: consumed by the callback route (R1/R2) and app shell. */
export interface OpenerLike {
  readonly closed: boolean;
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface SendAuthResultDeps {
  opener?: OpenerLike | null;
  createChannel?: (name: string) => AuthChannelLike | null;
}

/** Best-effort fan-out on all three channels; never throws. */
export function sendAuthResult(message: AuthResultMessage, deps: SendAuthResultDeps = {}): void {
  const opener = deps.opener === undefined ? (window.opener as OpenerLike | null) : deps.opener;
  const createChannel = deps.createChannel ?? createBroadcastChannel;

  if (opener !== null && opener !== undefined && !opener.closed) {
    try {
      opener.postMessage(message, window.location.origin);
    } catch {
      // Handled (§3.6): opener may be gone or cross-origin; the two
      // fallback channels below still deliver.
    }
  }
  try {
    const channel = createChannel(AUTH_CHANNEL_PREFIX + message.state);
    if (channel !== null) {
      channel.postMessage(message);
      channel.close();
    }
  } catch {
    // Handled (§3.6): BroadcastChannel is an optional delivery path.
  }
  // State-scoped so concurrent flows in other tabs cannot steal it (LOW-4).
  createStorage('local').setJSON(authResultStorageKey(message.state), message);
}

export type AuthCallbackOutcome =
  | { status: 'success' }
  | { status: 'error'; reason: 'missing_state' | 'session_invalid' | 'verify_failed' };

export interface AuthCallbackDeps {
  /** `window.location.search` of the callback page. */
  search: string;
  /** Session probe (auth/verify-session.ts); MUST use a client without `reauthenticate`. */
  verifySession: () => Promise<boolean>;
  postResult?: (message: AuthResultMessage) => void;
}

export async function completeAuthCallback(deps: AuthCallbackDeps): Promise<AuthCallbackOutcome> {
  const state = new URLSearchParams(deps.search).get(AUTH_STATE_PARAM);
  if (state === null || state === '') {
    // No state — not a correlated auth callback; nothing can be posted
    // (parity with the old page's error branch, pages/auth/index.jsx:36-40).
    return { status: 'error', reason: 'missing_state' };
  }
  const post = deps.postResult ?? sendAuthResult;

  let verified: boolean;
  let verifyThrew = false;
  try {
    verified = await deps.verifySession();
  } catch {
    // Handled (§3.6): a probe that cannot run proves no session — report
    // failure to the opener rather than guessing success.
    verified = false;
    verifyThrew = true;
  }

  post({ type: AUTH_MESSAGE_TYPE, state, success: verified });
  if (verified) return { status: 'success' };
  return { status: 'error', reason: verifyThrew ? 'verify_failed' : 'session_invalid' };
}
