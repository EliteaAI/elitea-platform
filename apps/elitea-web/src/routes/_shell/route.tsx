/**
 * The app shell — pathless layout route (spec ROUTE-002 `/*` -> `AppLayout`;
 * old app: `src/[fsd]/app/layout/AppLayout.jsx`). Every feature/settings
 * route in this unit is nested under this layout; `auth-callback` and
 * (unit R3's) `$projectId.$` / `$` catch-alls sit OUTSIDE it as top-level
 * siblings — matching spec: auth-callback has "**none** — no sidebar, no
 * guard", and the catch-alls do a hard `location.replace()`/render a
 * near-unreachable 404 with no need for shell chrome.
 *
 * Filename `_shell` (leading `_`): TanStack Router's pathless-layout
 * convention (verified against the installed
 * `@tanstack/router-generator@1.168.23`: `isSegmentPathless` strips any
 * leading-underscore segment from the URL). This route therefore adds NO
 * path segment — `_shell/onboarding.tsx` resolves to `/onboarding`, not
 * `/_shell/onboarding` — while still giving every child one shared
 * `beforeLoad`/`validateSearch`/component wrapper, which is exactly the ONE
 * coherent tree spec §3.2/P11 asks for (see `__root.tsx`'s header for the
 * old two-level-router bug this replaces).
 *
 * `AppLayout`'s real content (`MainSidebar` + `MainPanel`, interactive
 * tours, the support-assistant widget) is Wave-2/unit-S1 territory — task
 * item 6 explicitly scopes this unit to routing infrastructure, not page
 * content. What's real here: the pathless nesting itself, and the
 * shell-wide "on any" search-param scope (P1 `PARAM-062`..`PARAM-087`,
 * `commonSearchSchema`) every wrapped route inherits.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { commonSearchSchema } from '../-search/common';

export const Route = createFileRoute('/_shell')({
  validateSearch: commonSearchSchema,
  component: ShellLayout,
});

function ShellLayout() {
  return (
    // Sidebar/MainPanel chrome: Wave-2 (S1/widgets) territory. Wave-1 scope
    // is the Outlet wiring only.
    <Outlet />
  );
}
