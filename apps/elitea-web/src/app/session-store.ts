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
 */
import { create } from 'zustand';

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

export const useSessionStore = create<SessionState>((set) => ({
  user: undefined,
  loaded: false,
  fetchSession: async () => {
    try {
      const resp = await fetch('/forward-auth/info', { credentials: 'include' });
      if (!resp.ok) {
        set({ user: undefined, loaded: true });
        return;
      }
      const body = (await resp.json()) as SessionInfoResponse;
      if (!body.authenticated || !body.user_id) {
        set({ user: undefined, loaded: true });
        return;
      }
      set({
        user: {
          id: body.user_id,
          // personal_project_id not returned by /forward-auth/info yet;
          // treat a non-empty user_id as "has a personal project" so the
          // index route redirects to /chat rather than /onboarding.
          personal_project_id: body.user_id,
        },
        loaded: true,
      });
    } catch {
      set({ user: undefined, loaded: true });
    }
  },
}));

/** Stable AuthContext backed by the zustand store — passed to RouterProvider. */
export const sessionAuthContext: AuthContext = {
  getUser: () => useSessionStore.getState().user,
  getSelectedProjectId: () => undefined,
};
