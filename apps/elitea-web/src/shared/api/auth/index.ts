/**
 * Auth flow public surface (unit F4, spec §5.4). Named re-exports only
 * (elitea/no-export-all). Consumed by the app layer (R2) and the callback
 * route (Wave 1/2); until then the colocated tests are the consumers.
 */
export {
  AUTH_CALLBACK_PATH,
  AUTH_MESSAGE_TYPE,
  AUTH_STATE_PARAM,
  LOGOUT_PATH,
  isAuthResultMessage,
} from './constants';
/** @public Wave-1 surface: consumed by the callback route (R1/R2) and app shell. */
export type { AuthResultMessage } from './constants';
export { createBroadcastChannel } from './channel';
/** @public Wave-1 surface: consumed by the callback route (R1/R2) and app shell. */
export type { AuthChannelLike } from './channel';
export { AuthPopupError, createAuthPopupController } from './popup';
/** @public Wave-1 surface: consumed by the callback route (R1/R2) and app shell. */
export type {
  AuthPopupController,
  AuthPopupFailureReason,
  AuthPopupOptions,
  PopupWindowLike,
} from './popup';
export { completeAuthCallback, sendAuthResult } from './callback';
/** @public Wave-1 surface: consumed by the callback route (R1/R2) and app shell. */
export type { AuthCallbackDeps, AuthCallbackOutcome, OpenerLike, SendAuthResultDeps } from './callback';
export { VERIFY_SESSION_PATH, createVerifySession } from './verify-session';
/** @public Wave-1 surface: consumed by the callback route (R1/R2) and app shell. */
export type { SessionProbeClient } from './verify-session';
export { performLogout } from './logout';
/** @public Wave-1 surface: consumed by the callback route (R1/R2) and app shell. */
export type { LogoutDeps } from './logout';
