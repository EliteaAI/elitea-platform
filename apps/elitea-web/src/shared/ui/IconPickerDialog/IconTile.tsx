/**
 * IconTile — clickable wrapper for one icon in an icon picker's grid.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/project-context/ProjectIconItem.jsx`
 * and lifted out of `features/settings` when the SKILL icon picker needed the
 * same grid: a feature may not import another feature (R-L1), and the tile has
 * never held anything project-specific, so `shared/ui` is where it belongs.
 */
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';

export interface IconTileProps {
  isSelected: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export function IconTile({
  isSelected,
  onClick,
  children,
}: IconTileProps) {
  return (
    <Box
      onClick={onClick}
      sx={containerSx(isSelected)}
    >
      {children}
    </Box>
  );
}

function containerSx(isSelected: boolean): SxProps<Theme> {
  return (theme) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '3.5rem',
    width: '3.5rem',
    borderRadius: 'var(--el-shape-radiusSm, 4px)',
    border: `${isSelected ? 1 : 0}px solid ${theme.vars.palette.primary.main}`,
    background: isSelected
      ? theme.vars.palette.background.icon.default ?? theme.vars.palette.background.secondary
      : 'transparent',
    '&:hover': {
      border: `1px solid ${theme.vars.palette.border.flowNode}`,
      background: theme.vars.palette.background.icon.default ?? theme.vars.palette.background.secondary,
    },
    cursor: 'pointer',
  });
}
