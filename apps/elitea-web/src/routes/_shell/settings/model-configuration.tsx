/**
 * ROUTE-053 `/settings/model-configuration` -> `AIConfiguration`.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/pages/settings/AIConfiguration.jsx`.
 *
 * Changes from the baseline:
 * - Replaced `StickyTabs` with `BaseTab` + `BaseTabs` (R-UI-T2).
 * - Tour targets (`AI_CONFIG_TOUR_TARGET_IDS`) are dropped (tour system
 *   not ported in Wave-2/unit-A9).
 * - The old page rendered its own tab bar; the new layout is provided by
 *   `settings-layout.tsx` which renders `SettingsDrawer` + `<Outlet />`.
 *   This page is ONE of the two tab pages (AI Configuration / OpenAI Template).
 *   The real tab bar lives in `settings-layout.tsx`'s drawer.
 * - This component itself is a self-contained tab content renderer that
 *   hosts its own sub-tabs (Model Configuration / OpenAI Template),
 *   matching the old app's two-tab inner structure.
 */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { RouteShell } from '@/routes/-ui/RouteShell';

import { AIConfiguration } from '@/routes/_shell/settings/ai-configuration';

export const Route = createFileRoute('/_shell/settings/model-configuration')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: ModelConfigurationShell,
});

function ModelConfigurationShell() {
  return (
    <>
      <RouteShell routeId="settings.model-configuration" fallback="AI Configuration" />
      <AIConfiguration />
    </>
  );
}
