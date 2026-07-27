import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { combineSx } from '../lib/combineSx';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface HeadingChipProps {
  label: ReactNode;
  sx?: SxProps<Theme>;
}

/**
 * A chip-shaped label used as a visual section heading. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/chip/HeadingChip.jsx`.
 */
export function HeadingChip({ label, sx }: HeadingChipProps): ReactNode {
  return (
    <Box
      sx={combineSx(
        (theme: Theme) => ({
          display: 'inline-flex',
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          paddingBlock: theme.spacing(0.5),
          paddingInline: theme.spacing(2.5),
          gap: theme.spacing(2.5),
          background: theme.vars.palette.background.eliteaDefault,
          border: `1px solid ${theme.vars.palette.border.lines}`,
          borderRadius: theme.vars.shape.radiusSm,
          boxSizing: 'border-box',
          flexShrink: 0,
        }),
        sx,
      )}
    >
      <Typography
        variant="subtitle"
        color="text.secondary"
      >
        {label}
      </Typography>
    </Box>
  );
}
