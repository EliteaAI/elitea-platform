/**
 * Popup re-auth controller (spec §5.4 behaviours 3 + 4).
 *
 * Ported from apps/elitea-ui/src/[fsd]/features/auth/lib/helpers/
 * authPopup.helpers.js with two mandated fixes:
 *  - state is `crypto.randomUUID()` — the old flow used
 *    `Math.random().toString(36)+Date.now().toString(36)`
 *    (authPopup.helpers.js:42), not cryptographically random, and it is the
 *    value the callback is trusted against.
 *  - a controller INSTANCE (factory-created, injected) instead of the old
 *    module-scope promise + import-time listener side effects.
 *
 * Result delivery (all three old channels kept): opener postMessage,
 * BroadcastChannel `elitea-auth-<state>`, and the localStorage fallback
 * (storage event + poll) — read through the namespaced storage wrapper.
 */
import { createStorage } from '../../lib/storage';

import { createBroadcastChannel } from './channel';
import type { AuthChannelLike } from './channel';
import {
  AUTH_CALLBACK_PATH,
  AUTH_CHANNEL_PREFIX,
  AUTH_STATE_PARAM,
  AUTH_STATE_STORAGE_KEY,
  authResultStorageKey,
  isAuthResultMessage,
} from './constants';

/* Popup sizing — parity with authPopup.helpers.js:14-19. */
const MIN_WIDTH = 500;
const MIN_HEIGHT = 600;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 900;
const WIDTH_RATIO = 0.4;
const HEIGHT_RATIO = 0.7;
const DEFAULT_POLL_MS = 300; // authPopup.helpers.js:96

export type AuthPopupFailureReason = 'popup_blocked' | 'popup_closed' | 'auth_failed';

export class AuthPopupError extends Error {
  readonly reason: AuthPopupFailureReason;
  constructor(reason: AuthPopupFailureReason) {
    super(`auth popup: ${reason}`);
    this.name = 'AuthPopupError';
    this.reason = reason;
  }
}

export interface PopupWindowLike {
  readonly closed: boolean;
  close(): void;
}

export interface AuthPopupOptions {
  /** Origin the callback URL is built on; default `window.location.origin`. */
  baseOrigin?: string;
  /** App base path (e.g. `/elitea_ui`); default `''`. */
  basePath?: string;
  openWindow?: (url: string, name: string, features: string) => PopupWindowLike | null;
  createChannel?: (name: string) => AuthChannelLike | null;
  pollIntervalMs?: number;
}

export interface AuthPopupController {
  /**
   * Opens (or joins — single-flight) the re-auth popup. Resolves when the
   * popup reports a verified-session success for THIS flight's state;
   * rejects with `AuthPopupError` otherwise.
   */
  reauthenticate(): Promise<void>;
  readonly pending: boolean;
}

function defaultOpenWindow(url: string, name: string, features: string): PopupWindowLike | null {
  return window.open(url, name, features);
}

function popupFeatures(): string {
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(window.outerWidth * WIDTH_RATIO)));
  const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(window.outerHeight * HEIGHT_RATIO)));
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  return (
    `width=${width},height=${height},left=${left},top=${top},` +
    'menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes'
  );
}

export function createAuthPopupController(options: AuthPopupOptions = {}): AuthPopupController {
  const openWindow = options.openWindow ?? defaultOpenWindow;
  const createChannel = options.createChannel ?? createBroadcastChannel;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const session = createStorage('session');
  const local = createStorage('local');

  let flight: Promise<void> | null = null;

  function startFlight(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Behaviour 4: cryptographically random state, verified on delivery.
      const state = crypto.randomUUID();
      session.set(AUTH_STATE_STORAGE_KEY, state);

      let channel: AuthChannelLike | null = null;
      let intervalId: ReturnType<typeof setInterval> | null = null;
      // Per-flight settle guard. It deliberately does NOT consult `flight`:
      // the executor can settle SYNCHRONOUSLY (a blocked popup does exactly
      // that), before `reauthenticate` has even assigned the slot, so any
      // slot write from in here would be clobbered by that later assignment
      // and strand the controller. Slot ownership lives in `reauthenticate`.
      let settled = false;

      const cleanup = (): void => {
        window.removeEventListener('message', onWindowMessage);
        window.removeEventListener('storage', onStorageEvent);
        if (intervalId !== null) clearInterval(intervalId);
        channel?.close();
        session.remove(AUTH_STATE_STORAGE_KEY);
      };

      const settle = (error: AuthPopupError | null): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error === null) resolve();
        else reject(error);
      };

      const handleResult = (data: unknown): void => {
        // State verification: a result for any other state is ignored.
        if (!isAuthResultMessage(data) || data.state !== state) return;
        settle(data.success ? null : new AuthPopupError('auth_failed'));
      };

      const onWindowMessage = (event: MessageEvent): void => {
        if (event.origin !== window.location.origin) return;
        handleResult(event.data);
      };

      // The fallback key is state-scoped like the BroadcastChannel, so two
      // controllers (two tabs) can never consume each other's result.
      const resultKey = authResultStorageKey(state);

      const consumeStoredResult = (): void => {
        const stored = local.getJSON(resultKey, (raw) =>
          isAuthResultMessage(raw) ? raw : undefined,
        );
        if (stored === null) return;
        local.remove(resultKey);
        handleResult(stored);
      };

      const onStorageEvent = (): void => {
        consumeStoredResult();
      };

      window.addEventListener('message', onWindowMessage);
      window.addEventListener('storage', onStorageEvent);
      channel = createChannel(AUTH_CHANNEL_PREFIX + state);
      if (channel !== null) {
        channel.onmessage = (event): void => {
          handleResult(event.data);
        };
      }

      const callbackUrl =
        `${options.baseOrigin ?? window.location.origin}${options.basePath ?? ''}` +
        `${AUTH_CALLBACK_PATH}?${AUTH_STATE_PARAM}=${state}`;
      const popup = openWindow(callbackUrl, 'elitea-auth', popupFeatures());
      if (popup === null) {
        settle(new AuthPopupError('popup_blocked'));
        return;
      }

      intervalId = setInterval(() => {
        consumeStoredResult();
        if (!settled && popup.closed) {
          settle(new AuthPopupError('popup_closed'));
        }
      }, pollIntervalMs);
    });
  }

  return {
    reauthenticate() {
      // Controller-level single-flight (§5.4 behaviour 3 backstop; the HTTP
      // client also single-flights across its own concurrent 401s).
      if (flight !== null) return flight;
      const started = startFlight();
      // Assign BEFORE attaching the release handlers: a synchronously
      // settling flight (blocked popup — the common case, since re-auth
      // fires from a background 401 with no user activation) must still end
      // up with an empty slot, and the release below only clears the slot it
      // still owns, so a later flight is never cancelled by an earlier one.
      flight = started;
      const release = (): void => {
        if (flight === started) flight = null;
      };
      void started.then(release, release);
      return started;
    },
    get pending() {
      return flight !== null;
    },
  };
}
