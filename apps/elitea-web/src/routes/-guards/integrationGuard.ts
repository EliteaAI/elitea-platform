/**
 * IntegrationGuard (spec §9.3 R1; PERM-059; faithful port of
 * `apps/elitea-ui/src/[fsd]/app/routes/IntegrationGuard.jsx:9-22`).
 *
 * Old behaviour: `if (ALLOW_PROJECT_OWN_LLMS === false && projectId != PUBLIC_PROJECT_ID)
 * return <Navigate to="/settings/model-configuration" replace/>; return children;`
 * — create-configuration is hidden on non-public projects when the tenant
 * disallows project-owned LLM configurations (spec §8.6 credentials row).
 *
 * `ALLOW_PROJECT_OWN_LLMS` is unit F3's `allow_project_own_llms` config key
 * (`shared/config/schema.ts`'s `ConfigSchema`). A narrow interim workaround
 * used to live here (`-guards/env.ts`, now deleted) for a spec gap where
 * F3's schema didn't yet model this 6th C7 key; F3 has since folded it in —
 * see `schema.ts`'s own header for why the field is `z.unknown()` and
 * defaults to `true` (it preserves the exact non-coercing `=== false` check
 * below) — so this guard now reads it straight off `getConfig()`.
 */
import { redirect } from '@tanstack/react-router';

import type { RouterContext } from '@/app/router-context';
import { getConfig } from '@/shared/config';

import { isPublicProject } from './publicProject';

export function integrationGuardBeforeLoad({ context }: { context: RouterContext }): void {
  const projectId = context.auth.getSelectedProjectId();
  const result = getConfig();
  // `app/App.tsx` renders `MissingEnvPage` and returns BEFORE
  // `<RouterProvider>` — and therefore every `beforeLoad` — ever mounts, so
  // `status !== 'ok'` is unreachable in production use. Still handled
  // defensively (fall back to `true`, the old `getEnvVar('allow_project_own_llms',
  // true)` default) rather than assuming that ordering here, matching the
  // same posture `isPublicProject`/`getAppBasename` take on this exact
  // "config not yet resolved" branch.
  const allowProjectOwnLlms = result.status === 'ok' ? result.config.allow_project_own_llms : true;
  // Strict `=== false` on purpose: old app's own comparison is strict (no
  // coercion — a source-provided string `"false"` does NOT trip this), and
  // §11 D4-style guidance is to reproduce documented guard logic exactly.
  if (allowProjectOwnLlms === false && !isPublicProject(projectId)) {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's beforeLoad redirect contract: throw the Response redirect() returns, not an Error (verified against the installed @tanstack/router-core's own redirect() implementation).
    throw redirect({ to: '/settings/model-configuration' });
  }
}
