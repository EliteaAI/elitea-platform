import type { ReactNode } from 'react';
import { memo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/ai-assistant/
 * ui/AIAssistantPanelHeader.jsx` (baseline, 46 lines) — unit A2a.
 */
export interface AIAssistantPanelHeaderProps {
  readonly title: string;
  readonly actions?: ReactNode;
}

const panelHeaderSx: SxProps<Theme> = (theme) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  height: theme.spacing(5.5),
  gap: theme.spacing(1.25),
  padding: theme.spacing(0.75, 3),
  borderBottom: `0.0625rem solid ${theme.vars.palette.border.lines}`,
});

const headerActionsSx: SxProps<Theme> = (theme) => ({
  display: 'flex',
  gap: theme.spacing(1.5),
  alignItems: 'center',
});

/**
 * Baseline's `panelTitle` sx spreads `typography.subtitle` on top of a
 * `variant="labelSmall"` `Typography` and sets `color: palette.secondary.main`
 * directly (overriding the `color="text.secondary"` prop it also passes) —
 * net rendered result is `subtitle`'s font metrics at `secondary.main`.
 * Reproduced directly via `variant="subtitle"` (the font that actually
 * wins) + an explicit `color` sx (R-T7: `theme.vars.palette.*`, not the
 * `color="secondary"` shorthand, which resolves to `secondary.main` too but
 * is not itself a `theme.vars.palette.*` reference).
 */
const panelTitleSx: SxProps<Theme> = (theme) => ({
  color: theme.vars.palette.secondary.main,
});

export const AIAssistantPanelHeader = memo(function AIAssistantPanelHeader({
  title,
  actions,
}: AIAssistantPanelHeaderProps): ReactNode {
  return (
    <Box sx={panelHeaderSx}>
      <Typography
        variant="subtitle"
        sx={panelTitleSx}
      >
        {title}
      </Typography>
      <Box sx={headerActionsSx}>{actions}</Box>
    </Box>
  );
});
