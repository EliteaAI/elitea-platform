/**
 * Minimal OIDC session store (E2E bootstrap; Wave-3 #60).
 *
 * Calls /forward-auth/info at mount time to read the server-side session
 * cookie and populate the RouterContext's `auth` object.  Replaces the
 * permanent stubAuthContext stub so that the IndexRoute guard can resolve
 * the user and perform the correct redirect.
 *
 * Kept minimal intentionally — only the fields AuthUser requires for the
 * index-route and permission guards: `id` and `personal_project_id`.
 *
 * The store is a zustand slice (§2.3: no Redux); subscribed to by App.tsx
 * which passes a stable AuthContext object to <RouterProvider context=…>.
 *
 * Lazy-singleton factory pattern (R-S2) — see `widgets/app-shell/model/
 * navBlocker.store.ts` and `widgets/sidebar/model/sidebarCollapsed.store.ts`
 * for the rationale: the store is constructed on first use, not at module
 * evaluation, so bootstrap order stays explicit.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { createHttpClient } from '@/shared/api/http';
import { getConfig } from '@/shared/config';
import { readPersistedProject } from '@/shared/lib/selectedProjectPersistence';

import type { AuthContext, AuthUser } from './router-context';

interface SessionState {
  user: AuthUser | undefined;
  loaded: boolean;
  /**
   * HTTP status of the last `/forward-auth/info` probe, or undefined when the
   * request produced none. It is kept because "no user" alone cannot say WHERE
   * to send the browser: a 404 means that endpoint is not mounted, i.e. the
   * Form plane, and a 401 means the OIDC plane answered "no session". See
   * `shared/api/auth/login-redirect.ts`.
   */
  probeStatus: number | undefined;
  fetchSession: () => Promise<void>;
}

interface SessionInfoResponse {
  authenticated?: boolean;
  user_id?: string;
  email?: string;
}

/**
 * `GET /social/author` — the SAME endpoint the old SPA calls `authorDetails`
 * and reads `personal_project_id` off (`apps/elitea-ui/src/slices/settings.js:
 * 255-262`, which seeds the default project from it, and
 * `widgets/sidebar-root/ui/button/NotificationButton.jsx:18`, which scopes its
 * notification subscription to it). `shared/api/auth/verify-session.ts` already
 * documents this as this stack's `auth/me`-class endpoint.
 */
interface AuthorProfileResponse {
  id?: string;
  personal_project_id?: string;
}

const AUTHOR_PATH = '/social/author/';

/**
 * Reads the caller's personal project id from the API.
 *
 * Built here rather than reusing the module-level `/`-based client because
 * `/social/author` is served by the API base (`vite_server_url`), not by the
 * app origin. `reauthenticate` is deliberately NOT configured: this runs
 * inside the boot probe, where a 401 means "not logged in" — the answer we
 * are asking for — and escalating it into the re-auth popup would loop, the
 * same reasoning `createVerifySession` states for the callback probe.
 *
 * Returns `undefined` on any failure. `undefined` is meaningful: `AuthUser`
 * declares `personal_project_id` optional and consumers gate on it (the
 * notification subscription no-ops, the index guard sends the user to
 * onboarding) — which is the correct behaviour when the server cannot name a
 * personal project, and strictly better than inventing one.
 */
/**
 * The Form plane's session probe.
 *
 * `/forward-auth/info` exists only in the OIDC composition, so on a Form
 * deployment the probe above 404s and can never report a logged-in user — the
 * app would bounce a freshly-authenticated browser straight back to the login
 * form, forever. `/social/author` is the endpoint that CAN answer on both
 * planes: it is authenticated, and it returns the two fields a session needs.
 *
 * A 401 here means "not logged in", which is the answer being asked for, so
 * `reauthenticate` stays unconfigured for the same reason it does below.
 */
async function fetchAuthorSession(
  apiBaseUrl: string | undefined,
): Promise<{ id: string; personalProjectId: string | undefined } | undefined> {
  if (apiBaseUrl === undefined) return undefined;

  const http = createHttpClient({ baseUrl: apiBaseUrl });
  const result = await http.get<AuthorProfileResponse>(AUTHOR_PATH);
  if (!result.ok) return undefined;

  const id = result.data.id;
  if (id === undefined || id === '') return undefined;
  const personalProjectId = result.data.personal_project_id;
  return {
    id,
    personalProjectId: personalProjectId === '' ? undefined : personalProjectId,
  };
}

async function fetchPersonalProjectId(apiBaseUrl: string | undefined): Promise<string | undefined> {
  if (apiBaseUrl === undefined) return undefined;

  const http = createHttpClient({ baseUrl: apiBaseUrl });
  const result = await http.get<AuthorProfileResponse>(AUTHOR_PATH);
  if (!result.ok) return undefined;
  const id = result.data.personal_project_id;
  return id !== undefined && id !== '' ? id : undefined;
}

/**
 * The API base for the author probe. Resolved at CALL time, not at store
 * construction: `getConfig()` reads `window.elitea_ui_config`, which
 * `/app/config.js` installs before the bundle runs, and R-S2 forbids doing
 * that work at module scope.
 */
function resolveApiBaseUrl(): string | undefined {
  const config = getConfig();
  return config.status === 'ok' ? config.config.vite_server_url : undefined;
}

type SessionStore = UseBoundStore<StoreApi<SessionState>>;

/**
 * The session probe deliberately omits `reauthenticate`: a 401 here means
 * "not logged in", which is the answer we are asking for, not a condition to
 * recover from. Escalating it into the re-auth popup would loop.
 *
 * `baseUrl: '/'` — `/forward-auth/info` is served by the same origin as the
 * app, not by the API base.
 */
export interface CreateSessionStoreOptions {
  /**
   * API base for the `/social/author` probe. Defaults to the runtime config's
   * `vite_server_url`. An explicit value exists so a test can exercise the
   * probe without installing a whole runtime config object — the same
   * "inject the boundary, mock nothing else" shape `createVerifySession`
   * already uses for its client.
   */
  readonly apiBaseUrl?: string;
}

export function createSessionStore(options: CreateSessionStoreOptions = {}): SessionStore {
  const http = createHttpClient({ baseUrl: '/' });

  return create<SessionState>((set) => ({
    user: undefined,
    loaded: false,
    probeStatus: undefined,
    fetchSession: async () => {
      const result = await http.get<SessionInfoResponse>('/forward-auth/info');
      // The status lives in a different place on each arm of HttpResult, and
      // the arm that matters here is the FAILURE one: a 404 is what identifies
      // the Form plane. `network` and `aborted` failures carry no status.
      const probeStatus = result.ok
        ? result.status
        : 'status' in result.error
          ? result.error.status
          : undefined;
      if (!result.ok || !result.data.authenticated || !result.data.user_id) {
        // A 404 means the OIDC plane is not mounted, i.e. this is a Form
        // deployment, and the browser may well hold a valid Form session
        // cookie. Ask the endpoint that answers on both planes before
        // concluding "not logged in" — otherwise a logged-in user is sent back
        // to the login form on every load.
        if (probeStatus === 404) {
          const author = await fetchAuthorSession(options.apiBaseUrl ?? resolveApiBaseUrl());
          if (author !== undefined) {
            set({
              user: {
                id: author.id,
                ...(author.personalProjectId !== undefined
                  ? { personal_project_id: author.personalProjectId }
                  : {}),
              },
              loaded: true,
              probeStatus,
            });
            return;
          }
        }
        set({ user: undefined, loaded: true, probeStatus });
        return;
      }
      // `/forward-auth/info` (services/elitea-main/internal/api/v2/auth/
      // session.go) returns ONLY authenticated/user_id/email — there is no
      // project id in that response at all. This field used to be filled with
      // the USER id (issue #166), which is not a project id and generally
      // names a project the user is not a member of: `NotificationButton`
      // then opened its SSE subscription against it and was refused with a
      // 403, terminal for EventSource. The real source is `/social/author`.
      const personalProjectId = await fetchPersonalProjectId(options.apiBaseUrl ?? resolveApiBaseUrl());
      set({
        user: {
          id: result.data.user_id,
          ...(personalProjectId !== undefined ? { personal_project_id: personalProjectId } : {}),
        },
        loaded: true,
        probeStatus,
      });
    },
  }));
}

let instance: SessionStore | undefined;

function resolveStore(): SessionStore {
  instance ??= createSessionStore();
  return instance;
}

function useSessionStoreHook<T>(selector: (state: SessionState) => T): T {
  return resolveStore()(selector);
}

/** @public The lazily-constructed singleton, exposed with the hook + getState surface App.tsx uses. */
export const useSessionStore = Object.assign(useSessionStoreHook, {
  getState: (): SessionState => resolveStore().getState(),
  setState: (partial: Partial<SessionState>): void => resolveStore().setState(partial),
});

/**
 * `AuthContext.getSelectedProjectId`, resolving the currently selected
 * project for every consumer of the router context — `pages/agents`,
 * `features/apps` and `features/chat-input` each hold a `useSelectedProjectId`
 * hook that is a one-line read of this seam, and `routes/-guards/`
 * (`skillsGuard`, `integrationGuard`) call it directly.
 *
 * It returned a hardcoded `undefined` — the "R2 integration gap" App.tsx's own
 * header flags ("`<RouterProvider>` does not override the router's stub
 * `context.auth` with a real session-backed one"). Every query gated on the
 * resolved project id was therefore permanently disabled: `EditApplication`
 * never fetched an agent at all, so a deep link to `/agents/:tab/:id/:version`
 * cold-loaded to an empty page with the fallback "Agent" heading (JRNY-005).
 *
 * The selection itself already exists and is already persisted —
 * `widgets/app-shell`'s `useSelectedProject` writes it through
 * `writePersistedProject` on every `selectProject` call, before it updates its
 * own store — so reading the persisted value here is both current and
 * synchronous, which this non-hook seam requires. `app/` is also the only
 * layer permitted to reach into `widgets/` (the three `useSelectedProjectId`
 * duplicates sit in `pages/` and `features/`, which may not import upward).
 *
 * The `undefined` vs `''` branch is the baseline's, per AuthContext's own
 * contract (`router-context.ts`): with no selection but a personal project in
 * play, return `undefined` — "a project exists but is not the active
 * selection yet", which leaves guards on their defer path — and only return
 * `''` when there is no project context at all.
 */
function resolveSelectedProjectId(): string | undefined {
  const persisted = readPersistedProject();
  if (persisted !== null) return persisted.id;
  return useSessionStore.getState().user?.personal_project_id !== undefined ? undefined : '';
}

/** Stable AuthContext backed by the zustand store — passed to RouterProvider. */
export const sessionAuthContext: AuthContext = {
  getUser: () => useSessionStore.getState().user,
  getSelectedProjectId: resolveSelectedProjectId,
};
