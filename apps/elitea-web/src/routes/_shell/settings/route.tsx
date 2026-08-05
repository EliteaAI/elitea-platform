/**
 * ROUTE-051 `/settings` -> `Settings` layout (spec §8.1: "the only real
 * nested layout; `Settings` renders `SettingsDrawer` + `<Outlet/>`" — old
 * app `src/[fsd]/pages/settings/index.jsx:220`). A real directory layout
 * (`settings/route.tsx`), unlike the `$tab`-list families above: settings
 * children are meant to render together with a persistent drawer, not
 * exclusively (D4's `/settings/:tab` anomaly — see `$tab.tsx`'s header —
 * depends on exactly this: an unknown child still shows the layout with an
 * empty outlet).
 *
 * Query param PARAM-060 `createSecret` (spec QP-001) is scoped
 * `/settings/*` in P1's manifest (superseding the spec's illustrative
 * "`/settings/secrets` only" row) — declared here so every settings child
 * inherits it, not just `secrets.tsx`.
 */
import { createFileRoute } from '@tanstack/react-router';

import { pickParams } from '@/routes/-search/params';
import { SettingsLayout } from './settings-layout';

export const Route = createFileRoute('/_shell/settings')({
  validateSearch: pickParams('createSecret'),
  component: SettingsLayout,
});
