/**
 * `window.admin_ui_config` — the object the Go adminui handler substitutes into
 * `src/entries/admin/index.html` at serve time
 * (`services/elitea-main/internal/api/adminui/handler.go`).
 *
 * ## `permissions` is PRESENTATION state. It is NOT authorisation.
 *
 * That handler HARDCODES the permission array: every caller presenting a valid
 * `elitea_session` cookie receives the same fixed list of `admin.*` /
 * `configuration.*` strings, regardless of what roles they actually hold. It is
 * a hint about what to render, nothing more.
 *
 * The server is the gate. Every admin write is gated in
 * `internal/api/router.go` by `RequireCentralPermissions(…, "admin.auth.users")`,
 * which resolves the caller's permissions from `auth_core__user_role` on each
 * request, and `set_admin_role`'s super-admin escalation is checked again
 * inside the handler. Hiding a control here changes what a user SEES; it does
 * not change what they can DO, and treating it as though it did is the
 * inversion #11 got wrong in the LLM gateway.
 *
 * Accordingly nothing in this module is allowed to be the only thing standing
 * between a user and a mutation — the UI may use it to disable a control, and a
 * refused request still comes back 403 from the server either way.
 */

interface AdminUiConfig {
  readonly vite_server_url?: string;
  readonly vite_base_uri?: string;
  readonly user_id?: string | number;
  readonly user_name?: string;
  readonly user_email?: string;
  /** Presentation hint only — see this module's header. */
  readonly permissions?: readonly string[];
  readonly roles?: readonly string[];
}

declare global {
  interface Window {
    admin_ui_config?: AdminUiConfig;
  }
}

const EMPTY: AdminUiConfig = Object.freeze({});

/** Reads the injected config, or an empty object when the page was not served by the Go handler (dev, tests). */
function readAdminUiConfig(): AdminUiConfig {
  return globalThis.window?.admin_ui_config ?? EMPTY;
}

/** The API base the admin bundle talks to. Defaults to the same `/api/v2` the handler injects in production. */
export function adminApiBaseUrl(): string {
  const configured = readAdminUiConfig().vite_server_url;
  return configured !== undefined && configured !== '' ? configured : '/api/v2';
}

/**
 * The signed-in operator's display name for the nav footer.
 *
 * `user_name` is what the Go handler injects (it fills both `user_name` and
 * `user_email` from the session JWT's `email` claim), `user_email` is the
 * fallback for a handler that filled only one, and `'Admin'` is the last resort
 * for dev/tests where nothing was injected. There is no fabricated identity in
 * that chain: the fallback is a generic ROLE word, not a made-up person, and it
 * only ever appears when the page was not served by the handler.
 */
export function adminUiUserName(): string {
  const config = readAdminUiConfig();
  const name = config.user_name ?? config.user_email ?? '';
  return name !== '' ? name : 'Admin';
}

/**
 * A presentation-only permission probe. Named so no call site can mistake it
 * for an authorisation check.
 */
export function adminUiShowsControlFor(permission: string): boolean {
  return readAdminUiConfig().permissions?.includes(permission) ?? false;
}
