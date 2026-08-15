/**
 * "The signed-in user's personal project id" — the baseline's
 * `useSelector(state => state.user).personal_project_id`.
 *
 * A credential picker needs it for one thing only: to tell a PERSONAL saved
 * credential from a project one. The baseline reads the two apart the same way
 * (`isConfigurationPersonal` in `apps/elitea-ui/src/[fsd]/features/credentials/
 * ui/credentials-select/CredentialsSelect.jsx`), and the toolkit settings store
 * the answer back as the `private` half of `{elitea_title, private}`.
 *
 * Read through the SAME router-context seam as `./useSelectedProjectId.ts`
 * (`RouterContext.auth.getUser()`, unit R1/R2). `pages/` may not import
 * `src/app/` (`no-upward-from-pages`), so the session store is not reachable
 * from here directly.
 */
import { useRouteContext } from '@tanstack/react-router';

interface PersonalProjectIdContext {
  readonly auth?: {
    readonly getUser?: () => { readonly personal_project_id?: string } | undefined;
  };
}

function isPersonalProjectIdContext(value: unknown): value is PersonalProjectIdContext {
  return typeof value === 'object' && value !== null;
}

/** Pure extraction, unit-tested directly (no router needed) — the hook below is a one-line wrapper over this. */
export function selectPersonalProjectId(context: unknown): string | undefined {
  if (!isPersonalProjectIdContext(context)) return undefined;
  return context.auth?.getUser?.()?.personal_project_id;
}

export function usePersonalProjectId(): string | undefined {
  const context: unknown = useRouteContext({ strict: false });
  return selectPersonalProjectId(context);
}
