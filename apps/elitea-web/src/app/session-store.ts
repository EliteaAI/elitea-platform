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

/** Stable AuthContext backed by the zustand store — passed to RouterProvider. */
export const sessionAuthContext: AuthContext = {
  getUser: () => useSessionStore.getState().user,
  getSelectedProjectId: () => undefined,
};
