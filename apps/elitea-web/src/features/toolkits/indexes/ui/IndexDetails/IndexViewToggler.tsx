import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';

import { EditViewTabsEnum } from '../../lib/constants/indexDetails.constants';

/**
 * Port of `apps/elitea-ui/src/[fsd]/features/toolkits/indexes/ui/
 * IndexDetails/IndexViewToggler.jsx` (unit A4a). The baseline's
 * `ComponentsLib/Tooltip` wrapper has no `shared/ui` equivalent (grepped —
 * every other ported tooltip usage in this codebase's `shared/ui` either
 * wraps plain MUI `Tooltip` directly (`InfoTooltip.tsx`) or is a
 * content-shape-specific component, not a drop-in style wrapper); this uses
 * MUI's `Tooltip` directly, the same substitution `InfoTooltip.tsx` itself
 * makes.
 */
export interface IndexViewTogglerProps {
  readonly activeTab: string;
  readonly onChangeTab: (event: unknown, value: string | null) => void;
  readonly disableRunTabReason?: string | null | undefined;
  readonly disableHistoryTabReason?: string | null | undefined;
}

const wrapperSx: SxProps<Theme> = { marginBottom: '1.5rem' };

export function IndexViewToggler(props: IndexViewTogglerProps): ReactNode {
  const { activeTab, onChangeTab, disableRunTabReason, disableHistoryTabReason } = props;

  return (
    <Box sx={wrapperSx}>
      <ToggleButtonGroup
        size="small"
        value={activeTab}
        onChange={onChangeTab}
        exclusive
        aria-label={t('features.toolkits.indexViewToggler.ariaLabel', 'Edit Index Toggler')}
      >
        <Tooltip title={disableRunTabReason ?? ''}>
          <Box component="span">
            <ToggleButton
              value={EditViewTabsEnum.run}
              key={EditViewTabsEnum.run}
              sx={(theme) => ({
                textTransform: 'capitalize',
                borderRadius: `${theme.vars.shape.radiusMd} 0 0 ${theme.vars.shape.radiusMd}`,
              })}
              disabled={Boolean(disableRunTabReason)}
            >
              {EditViewTabsEnum.run}
            </ToggleButton>
          </Box>
        </Tooltip>

        <ToggleButton
          value={EditViewTabsEnum.configuration}
          key={EditViewTabsEnum.configuration}
          sx={{ textTransform: 'capitalize' }}
        >
          {EditViewTabsEnum.configuration}
        </ToggleButton>

        <Tooltip title={disableHistoryTabReason ?? ''}>
          <Box component="span">
            <ToggleButton
              value={EditViewTabsEnum.history}
              key={EditViewTabsEnum.history}
              sx={(theme) => ({
                textTransform: 'capitalize',
                borderRadius: `0 ${theme.vars.shape.radiusMd} ${theme.vars.shape.radiusMd} 0`,
              })}
              disabled={Boolean(disableHistoryTabReason)}
            >
              {EditViewTabsEnum.history}
            </ToggleButton>
          </Box>
        </Tooltip>
      </ToggleButtonGroup>
    </Box>
  );
}
