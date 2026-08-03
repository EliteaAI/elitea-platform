/**
 * ProjectIconItem — clickable wrapper for a project icon.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/project-context/ProjectIconItem.jsx`.
 */
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';

export interface ProjectIconItemProps {
  isSelected: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export function ProjectIconItem({
  isSelected,
  onClick,
  children,
}: ProjectIconItemProps) {
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
  return ({ palette }) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '3.5rem',
    width: '3.5rem',
    borderRadius: 'var(--el-shape-radiusSm, 4px)',
    border: `${isSelected ? 1 : 0}px solid ${palette.primary.main}`,
    background: isSelected
      ? palette.background.icon?.default ?? palette.background.secondary
      : 'transparent',
    '&:hover': {
      border: `1px solid ${palette.border.flowNode}`,
      background: palette.background.icon?.default ?? palette.background.secondary,
    },
    cursor: 'pointer',
  });
}
