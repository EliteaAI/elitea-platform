import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { BaseTab } from '@/shared/ui/BaseTab';
import { BaseTabs } from '@/shared/ui/BaseTabs';

const pageSx: SxProps<Theme> = { height: '100%', display: 'flex', flexDirection: 'column' };
const tabBarSx: SxProps<Theme> = { flexShrink: 0, borderBottom: 1, borderColor: 'divider', padding: '0 1.5rem' };
const tabPanelSx: SxProps<Theme> = { flex: 1, minHeight: 0, overflowY: 'auto' };

export interface ToolkitsProps {
  readonly isMCP?: boolean;
}

/**
 * Ported from `apps/elitea-ui/src/pages/Toolkits/Toolkits.jsx` (39 lines) —
 * ROUTE-030-family (`/toolkits/:tab`, `/mcps/:tab`; spec §8.1). The route
 * itself decides which of the two this page renders (`isMCP`), mirroring
 * the baseline's own single component reused for both
 * `RouteDefinitions.ToolkitsWithTab`/`MCPsWithTab`.
 *
 * **Composition gap, disclosed, STILL REAL (updated — read before assuming
 * this is stale).** The baseline's entire body is `<StickyTabs>` wrapping
 * ONE tab whose `content` is `<ToolkitsList isMCP cardContentType={...} />`
 * (`@/[fsd]/features/toolkits/ui/list/ToolkitsList`) plus a
 * `middleTabComponent={<ViewToggle />}`. `features/toolkits/ui/list/
 * ToolkitsList.tsx` (this app's port) now EXISTS and is exported from that
 * slice's public `index.ts` (landed after this file's own first draft) —
 * but wiring it here needs MORE than the list component alone: a real
 * `data`/`listState` source (`useLoadToolkits`, `features/toolkits/lib/
 * hooks/useLoadToolkits.ts`) and a `renderCard` (no card component exists
 * either), NEITHER of which is exported from that slice's public API — its
 * budget is already at the §3.5 20-symbol ceiling with the four pieces this
 * unit's OWN `CreateToolkit.tsx`/`EditToolkit.tsx` need instead (see
 * `features/toolkits/index.ts`'s own doc comment for the exact accounting).
 * `ViewToggle`/`StickyTabs` still have no port anywhere in this worktree
 * either way. A disclosed placeholder stands in the list's place below,
 * same `data-testid` convention `pages/agents/EditApplication.tsx`
 * establishes for its own equivalent gap — the CRUD surface
 * (create/edit/delete/export/type-selection, this unit's real priority) is
 * fully landed in `CreateToolkit.tsx`/`EditToolkit.tsx` instead.
 */
export function Toolkits({ isMCP = false }: ToolkitsProps): ReactNode {
  const title = isMCP ? t('pages.toolkits.toolkits.titleMcp', 'MCPs') : t('pages.toolkits.toolkits.title', 'Toolkits');

  return (
    <Box sx={pageSx}>
      <Box sx={tabBarSx}>
        <BaseTabs
          value={0}
          aria-label={title}
        >
          <BaseTab
            label={title}
            data-testid="toolkits-tab-all"
          />
        </BaseTabs>
      </Box>
      <Box
        sx={tabPanelSx}
        role="tabpanel"
      >
        {/* Composition gap: `ToolkitsList` is not in this unit's (A4g) owned-file list — see the module doc comment above. */}
        <Box data-testid={isMCP ? 'mcps-list-panel' : 'toolkits-list-panel'} />
      </Box>
    </Box>
  );
}
