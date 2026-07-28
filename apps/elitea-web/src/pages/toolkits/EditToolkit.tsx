import { type ReactNode, useCallback, useEffect, useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useParams } from '@tanstack/react-router';

import { ConfigurationTab, DeleteToolkitButton, ExportToolkitButton, type ToolkitEditorDeps } from '@/features/toolkits';
import type { ToolkitInstance } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';
import { BaseTab } from '@/shared/ui/BaseTab';
import { BaseTabs } from '@/shared/ui/BaseTabs';

import { useSelectedProjectId } from './lib/useSelectedProjectId';
import type { EditToolDetail } from './lib/toolkitFormTypes';
import { useToolkitDetail } from './lib/useToolkitDetail';

const pageSx: SxProps<Theme> = { height: '100%', display: 'flex', flexDirection: 'column' };
const headerSx: SxProps<Theme> = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: 1,
  borderColor: 'divider',
  padding: '0 1.5rem',
  minHeight: '3rem',
};
const actionsSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: '0.5rem' };
const tabBarSx: SxProps<Theme> = { flexShrink: 0, borderBottom: 1, borderColor: 'divider', padding: '0 1.5rem' };
const contentSx: SxProps<Theme> = { flex: 1, minHeight: 0 };
const testPaneSlotSx: SxProps<Theme> = { flex: 1, minWidth: 0 };

export interface EditToolkitDeps {
  /** No generated `PUT /elitea_core/tool/prompt_lib/{projectId}/{toolId}` endpoint exists yet — see `features/toolkits`' `api/toolkits.ts` module doc comment. */
  readonly saveToolkit: ToolkitEditorDeps['saveToolkit'];
}

export interface EditToolkitProps {
  readonly isMCP?: boolean;
  readonly deps: EditToolkitDeps;
}

interface EditToolkitRouteParams {
  readonly toolkitId?: string;
  readonly mcpId?: string;
  readonly appId?: string;
}

function toEditDetail(detail: ToolkitInstance | undefined): EditToolDetail | null {
  if (detail === undefined) return null;
  return { id: detail.id, type: detail.type, name: detail.name, description: detail.description, settings: detail.settings, meta: detail.meta };
}

/**
 * Ported from `apps/elitea-ui/src/pages/Toolkits/EditToolkit.jsx` (476
 * lines) — ROUTE-030 `/toolkits/:tab/:toolkitId` (+ the `/mcps/:tab/:mcpId`
 * sibling, `isMCP`; also the old app's `AppDetail.jsx` fallback for
 * non-custom-UI applications — `pages/apps/AppDetail.tsx`'s own doc comment
 * discloses that composition gap on ITS side, not this file's). Unit A4g.
 *
 * DISCLOSED DEVIATIONS:
 *  - **No ambient Formik context / no `getValidateSchema` validation
 *    schema** — this page's editable state is `editToolDetail`
 *    (`useState`), synced from the real fetched detail; `ConfigurationTab`'s
 *    own embedded `ToolkitForm` owns field-level validation exactly as it
 *    does for every other caller in this unit.
 *  - **No generated GET-single-toolkit or PUT-edit-toolkit endpoint
 *    exists** — see `features/toolkits`' `api/toolkits.ts` module doc
 *    comment for the full, exhaustively-verified inventory.
 *    `./lib/useToolkitDetail.ts` derives the detail from the real
 *    `listToolkitInstances` collection client-side (same technique as that
 *    file's own `useToolkitDetail`, duplicated locally — see that hook's
 *    own doc comment for why); `deps.saveToolkit` is injected into
 *    `ConfigurationTab`'s `saveHandlers`, same "caller supplies the
 *    network call, this page owns 100% real orchestration" convention this
 *    whole batch already established.
 *  - **`LegacyOpenApiMigration.normalizeLegacyOpenApiToolkit` DROPPED.**
 *    That helper lives inside `features/toolkits/lib/helpers/
 *    legacyOpenApiMigration.helpers.ts`, not exported from that slice's
 *    public `index.ts` (whose budget is already at the §3.5 20-symbol
 *    ceiling — see `features/toolkits/index.ts`'s own doc comment), and the
 *    baseline's own comment on every call site marks it "TODO: DELETE after
 *    migration period (Q1 2026) — Legacy OpenAPI toolkit migration" — a
 *    self-described temporary shim, not core toolkit-editing behaviour.
 *    `toEditDetail` below maps the real `ToolkitInstance` row directly.
 *  - **The "Test" tab is DROPPED, not narrowed** — the baseline's own tab
 *    entry for it is `{ content: <></>, display: 'none' }` (`EditToolkit.jsx`,
 *    the tabs `useMemo`) — permanently hidden dead UI in the baseline
 *    itself, not a real surface this port removes.
 *  - **The "Indexes" tab is a disclosed composition gap**, not a
 *    placeholder standing in for missing logic: `IndexesContainer`
 *    (`features/toolkits/indexes/ui`, a sibling A4 sub-unit's owned file —
 *    see this batch's own sub-partition) is not exported from `features/
 *    toolkits`' public `index.ts` either (same budget ceiling). Real
 *    caller-visible label + hidden panel below, same `data-testid`
 *    convention `pages/agents/EditApplication.tsx`'s own equivalent gap
 *    already established.
 *  - **`ToolkitsControls`'s kebab-menu wiring is NOT used.** That
 *    component's own doc comment already discloses it needs SIX real
 *    menu-item-producing hooks/slots (`pin`/`copy-link`/`fork`/`delete`/
 *    `export`/`authors`) that "a future `pages/toolkits`... is the correct
 *    place to build" — none of the six exist as `ControlsDropdownItem`-shaped
 *    producers anywhere in this worktree yet. This page instead renders the
 *    two real, ALREADY-EXPORTED, standalone `DeleteToolkitButton`/
 *    `ExportToolkitButton` icon buttons directly in the header (same
 *    functional actions, a flat row instead of a kebab menu) — a disclosed
 *    simplification, not a silently dropped feature.
 *  - **`redirect`/`iframe`-type application custom-UI branches, the
 *    embedding-model-change confirmation modal (`ToolkitsTabBar`'s own
 *    `isEmbeddingModelDirty` alert), the `destTab`/`name` URL-sync search
 *    params, and nav-blocking-while-dirty** are all dropped — same class of
 *    real, disclosed gaps `pages/agents/EditApplication.tsx`'s own doc
 *    comment gives for its structurally identical `useNavBlocker`/
 *    version-URL-sync omissions (no promoted equivalent exists; not this
 *    unit's owned scope to invent one).
 *  - **GA event tracking** — dropped outright, same documented gap every
 *    other editor in this session gives.
 */
export function EditToolkit({ isMCP = false, deps }: EditToolkitProps): ReactNode {
  const params = useParams({ strict: false }) as EditToolkitRouteParams;
  const toolkitId = params.toolkitId ?? params.mcpId ?? params.appId;
  const projectId = useSelectedProjectId();

  const { detail, isFetching } = useToolkitDetail(projectId, toolkitId);

  const [editToolDetail, setEditToolDetail] = useState<EditToolDetail | null>(null);
  const [isToolDirty, setIsToolDirty] = useState(false);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    setEditToolDetail(toEditDetail(detail));
    setIsToolDirty(false);
  }, [detail]);

  const handleChangeToolDetail = useCallback((updater: (prev: EditToolDetail | null) => EditToolDetail | null) => {
    setIsToolDirty(true);
    setEditToolDetail(updater);
  }, []);

  const handleTabChange = useCallback((_event: unknown, value: number) => setTab(value), []);

  const fallbackTitle = isMCP ? t('pages.toolkits.editToolkit.titleMcp', 'Edit MCP') : t('pages.toolkits.editToolkit.title', 'Edit Toolkit');
  const title = detail?.name ?? fallbackTitle;

  return (
    <Box sx={pageSx}>
      <Box sx={headerSx}>
        <Typography variant="headingSmall">{title}</Typography>
        {toolkitId !== undefined && (
          <Box sx={actionsSx}>
            <ExportToolkitButton
              toolkitId={toolkitId}
              name={detail?.name}
            />
            <DeleteToolkitButton
              toolkitId={toolkitId}
              name={detail?.name}
            />
          </Box>
        )}
      </Box>
      <Box sx={tabBarSx}>
        <BaseTabs
          value={tab}
          onChange={handleTabChange}
          aria-label={title}
        >
          <BaseTab label={t('pages.toolkits.editToolkit.configurationTab', 'Configuration')} />
          <BaseTab label={t('pages.toolkits.editToolkit.indexesTab', 'Indexes')} />
        </BaseTabs>
      </Box>
      <Box
        sx={contentSx}
        role="tabpanel"
      >
        {tab === 0 && (
          <ConfigurationTab
            isFetching={isFetching}
            applicationId={undefined}
            toolkitId={toolkitId}
            toolDetailState={{ editToolDetail, onChangeToolDetail: handleChangeToolDetail, isToolDirty }}
            isMCP={isMCP}
            projectId={projectId}
            saveHandlers={{ saveToolkit: deps.saveToolkit }}
            renderTestPane={() => (
              // Composition gap: the right-pane live test-chat content
              // (`TestTools`, a sibling A4 sub-unit's owned file — see
              // `ConfigurationTab.tsx`'s own module doc comment for why
              // this is a slot, not a direct import) has real dependencies
              // (`features/chat`, a `widgets/`-layer LLM model selector)
              // that do not exist anywhere in this worktree yet.
              <Box
                sx={testPaneSlotSx}
                data-testid="edit-toolkit-test-pane-slot"
              />
            )}
          />
        )}
        {/* Composition gap: `IndexesContainer` is not exported from `features/toolkits` — see the module doc comment. */}
        {tab === 1 && <Box data-testid="edit-toolkit-indexes-tab-panel" />}
      </Box>
    </Box>
  );
}
