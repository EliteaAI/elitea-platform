import { type ReactNode, useMemo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { SingleSelect } from '@/shared/ui/SingleSelect';
import type { SingleSelectOption } from '@/shared/ui/SingleSelect';

/**
 * One status-filter tab, as fed in by the caller (list of agent-page tabs —
 * e.g. "My Agents" / "Shared with me" / "Public"). Mirrors the shape old
 * app's `tabs` prop items are read for (`item.display`, `item.label`).
 */
export interface StatusFilterTab {
  readonly label: string;
  /** `'none'` hides the tab from the dropdown (old app: `item.display !== 'none'` filter, `StatusFilterSelect.jsx:14`); any other value (or `undefined`) shows it. */
  readonly display?: string;
}

/** @public */
export interface StatusFilterSelectProps {
  /** Whether the current project is the public/marketplace project — swaps the "Statuses:"/"Filter by:" label (old app: `projectId != PUBLIC_PROJECT_ID`, `StatusFilterSelect.jsx:29`). */
  isPublicProject: boolean;
  selectedTab: number;
  tabs: readonly StatusFilterTab[];
  onChangeTab: (tabIndex: number) => void;
  sx?: SxProps<Theme>;
}

/**
 * Ported from `apps/elitea-ui/src/pages/Applications/Components/
 * StatusFilterSelect.jsx`. A label plus a `SingleSelect` of visible tabs.
 *
 * DISCLOSED DEVIATIONS from the baseline:
 *  - `projectId != PUBLIC_PROJECT_ID` is replaced with an explicit
 *    `isPublicProject` boolean prop. `PUBLIC_PROJECT_ID` is a per-deployment
 *    runtime-config value (`shared/config`, unit F3), not a fixed constant
 *    (see `entities/project`'s `isPublicProject` selector doc comment) —
 *    reading `shared/config` directly from a `features/` component would
 *    work layer-wise, but the caller (a `pages/agents` list screen) already
 *    knows which project is selected and whether it's public; passing the
 *    already-computed boolean avoids a second, redundant config read here.
 *  - `shared/ui`'s `SingleSelect` takes a `value: string` (see that
 *    component's own doc comment: the baseline's 50-prop `SingleSelect` was
 *    trimmed to the single-value case). The baseline passed a numeric tab
 *    INDEX directly; this wraps it to/from `String(index)` at the boundary
 *    — `onChangeTab` still receives a number, unchanged for callers.
 */
export function StatusFilterSelect({
  isPublicProject,
  selectedTab,
  tabs,
  onChangeTab,
  sx,
}: StatusFilterSelectProps): ReactNode {
  const statusOptions = useMemo<SingleSelectOption[]>(
    () =>
      tabs
        .map((tab, index) => ({ tab, index }))
        .filter(({ tab }) => tab.display !== 'none')
        .map(({ tab, index }) => ({ label: tab.label, value: String(index) })),
    [tabs],
  );

  return (
    <Box sx={containerSx}>
      <Box sx={labelBoxSx}>
        <Typography
          component="div"
          variant="bodyMedium"
          color="text.default"
        >
          {isPublicProject
            ? t('agents.statusFilterSelect.filterBy', 'Filter by:')
            : t('agents.statusFilterSelect.statuses', 'Statuses:')}
        </Typography>
      </Box>
      <Box sx={selectBoxSx}>
        <SingleSelect
          value={String(selectedTab)}
          onChange={(value) => onChangeTab(Number(value))}
          options={statusOptions}
          {...(sx !== undefined ? { sx } : {})}
        />
      </Box>
    </Box>
  );
}

const containerSx: SxProps<Theme> = {
  display: 'flex',
  marginLeft: '0.5rem',
  zIndex: 1001,
  minWidth: '7.3125rem',
  gap: '0.75rem',
  alignItems: 'center',
  height: '100%',
};

const labelBoxSx: SxProps<Theme> = {
  height: '1.5rem',
  width: '3.75rem',
};

const selectBoxSx: SxProps<Theme> = {
  flex: 1,
};
