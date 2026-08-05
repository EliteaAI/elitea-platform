import { useEffect, useMemo, type ReactNode, type SyntheticEvent } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { useNavigate, useParams } from '@tanstack/react-router';

import { t } from '@/shared/i18n';
import { BaseTab } from '@/shared/ui/BaseTab';
import { BaseTabs } from '@/shared/ui/BaseTabs';

import { isPublicPipelinesProject } from './lib/isPublicPipelinesProject';
import { useHasAdminPermission } from './lib/useHasAdminPermission';
import { useSelectedProjectId } from './lib/useSelectedProjectId';
import { usePipelinesData } from './usePipelinesData';
import { usePipelineTabs } from './usePipelineTabs';

const pageSx: SxProps<Theme> = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};

const tabBarSx: SxProps<Theme> = {
  flexShrink: 0,
  borderBottom: 1,
  borderColor: 'divider',
  padding: '0 1.5rem',
};

const tabPanelSx: SxProps<Theme> = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
};

interface PipelinesRouteParams {
  readonly tab?: string;
}

/**
 * Ported from `apps/elitea-ui/src/pages/Pipelines/Pipelines.jsx` —
 * ROUTE-019 `/pipelines/:tab` (spec §8.1), the top-level tab shell over
 * `Latest`/`MyLiked`/`Trending`/`PrivatePipelinesList` (all this unit,
 * A2m). Structurally the pipelines-domain mirror of `pages/agents/
 * Applications.tsx` (Wave-2 unit A1g) — a Pipeline literally IS an
 * Application row (`agent_type: 'pipeline'`, see `entities/pipeline/model/
 * types.ts`'s own doc comment) — narrowed to the ONE private "All" tab the
 * baseline's own `Pipelines.jsx` actually renders (see `usePipelineTabs.tsx`
 * doc comment) rather than the agents domain's six-status split.
 *
 * **Composition gaps, disclosed (same pattern `pages/agents/Applications.tsx`
 * established for its own not-yet-landed siblings):**
 *  - `SingleSelect`-based status filter dropdown (`Pipelines.jsx`'s own
 *    `middleTabComponent`, `statusFilterWrapper`/`statusOptions`) has no
 *    confirmed port in this unit's ownership fence; `BaseTabs` already
 *    provides equivalent tab selection via click, so this page does not
 *    duplicate it.
 *  - `ToolbarImportButton` (`@/[fsd]/entities/import-wizard/ui`) and
 *    `ViewToggle` (`@/components/ViewToggle`) have no confirmed port
 *    anywhere in `shared/ui`/`widgets` (grepped both trees for both names —
 *    zero hits), same gap `pages/agents/Applications.tsx` documents.
 *  - `DateRangeSelect`/`useTrendRange` — see `Trending.tsx`'s own doc
 *    comment: the backing `trend_start_period` filter has no server-side
 *    support at all, so there is nothing for a working date picker to
 *    control.
 */
export function Pipelines(): ReactNode {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as PipelinesRouteParams;
  const projectId = useSelectedProjectId();
  const isPublicProject = isPublicPipelinesProject(projectId);
  const hasAdminPermission = useHasAdminPermission(isPublicProject ? projectId : undefined);
  const totals = usePipelinesData(projectId, hasAdminPermission);
  const tabs = usePipelineTabs(isPublicProject, totals, hasAdminPermission);

  const visibleTabs = useMemo(() => tabs.filter((tab) => tab.hidden !== true), [tabs]);
  const selectedIndex = visibleTabs.findIndex((tab) => tab.value === params.tab);

  useEffect(() => {
    if (selectedIndex !== -1) return;
    const firstTab = visibleTabs[0];
    if (firstTab === undefined) return;
    void navigate({ to: '/pipelines/$tab', params: { tab: firstTab.value }, replace: true });
  }, [selectedIndex, visibleTabs, navigate]);

  const handleChangeTab = (_event: SyntheticEvent, nextIndex: number): void => {
    const nextTab = visibleTabs[nextIndex];
    if (nextTab === undefined) return;
    void navigate({ to: '/pipelines/$tab', params: { tab: nextTab.value } });
  };

  return (
    <Box sx={pageSx}>
      <Box sx={tabBarSx}>
        <BaseTabs
          value={selectedIndex === -1 ? false : selectedIndex}
          onChange={handleChangeTab}
          aria-label={t('pages.pipelines.pipelines.tabsAriaLabel', 'Pipelines')}
        >
          {visibleTabs.map((tab) => (
            <BaseTab
              key={tab.value}
              label={tab.count === undefined ? tab.label : `${tab.label} (${tab.count})`}
              data-testid={`pipelines-tab-${tab.value}`}
            />
          ))}
        </BaseTabs>
      </Box>
      <Box
        sx={tabPanelSx}
        role="tabpanel"
      >
        {selectedIndex !== -1 ? visibleTabs[selectedIndex]?.content : null}
      </Box>
    </Box>
  );
}
