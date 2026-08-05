/**
 * ROUTE-047 `/mode-switch` -> `ModeSwitch` (spec §8.1).
 *
 * Was a `RouteShell` placeholder while `pages/mode-switch/ModeSwitch.tsx` sat
 * unimported — knip (#71) surfaced that page as an unused file. The baseline
 * routes the real page (`[fsd]/app/routes/ProtectedRoutes.jsx:241`,
 * `{ path: RouteDefinitions.ModeSwitch, element: <ModeSwitch /> }`), so the
 * placeholder was a parity gap, not dead code, and the fix is to render the
 * page that had already been built.
 *
 * The page deliberately renders only its heading: its toggle is gated behind
 * `enableToggle = false`, faithfully reproducing the baseline's own
 * permanently-disabled flag (`pages/ModeSwitch.jsx:33`). Theme switching is
 * handled by `ThemeModeToggle` in `shared/ui`, not here.
 */
import { createFileRoute } from '@tanstack/react-router';

import { ModeSwitch } from '@/pages/mode-switch/ModeSwitch';

import { RouteError, RoutePending } from '../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/mode-switch')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: ModeSwitch,
});
