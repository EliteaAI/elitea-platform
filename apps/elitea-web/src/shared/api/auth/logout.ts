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

import { LOGOUT_PATH } from './constants';

export interface LogoutDeps {
  /** Navigation seam; default assigns `window.location.href`. */
  redirect?: (url: string) => void;
  /** Origin the forward-auth logout URL is built on; default page origin. */
  origin?: string;
}

/**
 * Clears the entire `el.` namespace (local + session), then hands the
 * browser to the backend logout (old UserButton.jsx:32 preserved:
 * `{origin}/forward-auth/logout`).
 */
export function performLogout(deps: LogoutDeps = {}): void {
  clearNamespace();
  const origin = deps.origin ?? window.location.origin;
  const redirect =
    deps.redirect ??
    ((url: string): void => {
      window.location.href = url;
    });
  redirect(origin + LOGOUT_PATH);
}
