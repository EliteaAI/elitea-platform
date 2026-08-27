/**
 * Pure reads for `Onboarding.tsx`.
 *
 * Split out for the §3.5 file-length budget, and because they are the parts
 * with no React in them: each one turns an untyped value the page is handed —
 * a query envelope, the router context — into the one field the page needs.
 */

/**
 * The caller's profile, read out of the generated query's enveloped
 * `{data, status, headers}` result — the same read `widgets/app-shell`'s
 * `personalProjectIdOf` performs, and for the same reason (`eliteaFetch`
 * throws on non-2xx, so the 401 arm is unreachable at this read site).
 */
interface AuthorProfile {
  readonly id?: string;
  readonly name?: string;
  readonly email?: string;
  readonly personal_project_id?: string;
}

export function authorOf(data: unknown): AuthorProfile | undefined {
  return (data as { readonly data?: AuthorProfile } | undefined)?.data;
}

/**
 * `user.name || user.email` — the baseline's own fallback
 * (`Onboarding.jsx`'s `<Welcome name={user.name || user.email}/>`). `Welcome`
 * supplies its own "there" when both are blank.
 */
export function displayName(author: AuthorProfile): string | undefined {
  if (author.name !== undefined && author.name !== '') return author.name;
  if (author.email !== undefined && author.email !== '') return author.email;
  return undefined;
}

/**
 * `auth.refreshSession` from the TanStack Router root context
 * (`src/app/router-context.ts`) — read structurally rather than imported,
 * because `pages/` may not import `app/` (`no-upward-from-pages`). Same shape
 * `features/settings`'s `TokensTable` uses to read `auth.getUser`.
 *
 * WHY THE PAGE NEEDS IT. The route guards do not read the author query; they
 * read the session the router was given, and that session captured
 * `personal_project_id: undefined` at boot. Without a refresh, a user who
 * finishes onboarding and later navigates to `/` is judged by the stale
 * session and sent straight back here.
 */
interface SessionRefreshContext {
  readonly auth?: {
    readonly refreshSession?: () => Promise<void>;
  };
}

export function selectRefreshSession(context: unknown): (() => Promise<void>) | undefined {
  if (typeof context !== 'object' || context === null) return undefined;
  return (context as SessionRefreshContext).auth?.refreshSession;
}
