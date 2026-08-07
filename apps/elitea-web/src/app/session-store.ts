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
import { readPersistedProject } from '@/widgets/app-shell';

import type { AuthContext, AuthUser } from './router-context';

interface SessionState {
  user: AuthUser | undefined;
  loaded: boolean;
  fetchSession: () => Promise<void>;
}

interface SessionInfoResponse {
  authenticated?: boolean;
  user_id?: string;
  email?: string;
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
export function createSessionStore(): SessionStore {
  const http = createHttpClient({ baseUrl: '/' });

  return create<SessionState>((set) => ({
    user: undefined,
    loaded: false,
    fetchSession: async () => {
      const result = await http.get<SessionInfoResponse>('/forward-auth/info');
      if (!result.ok || !result.data.authenticated || !result.data.user_id) {
        set({ user: undefined, loaded: true });
        return;
      }
      set({
        user: {
          id: result.data.user_id,
          // personal_project_id not returned by /forward-auth/info yet;
          // treat a non-empty user_id as "has a personal project" so the
          // index route redirects to /chat rather than /onboarding.
          personal_project_id: result.data.user_id,
        },
        loaded: true,
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
