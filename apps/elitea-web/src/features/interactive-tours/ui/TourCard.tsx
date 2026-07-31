/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/ui/TourCard.tsx`
 */

import { forwardRef, memo } from 'react';

import Box, { type BoxProps } from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

interface TourCardProps extends BoxProps<'div', { component?: undefined }> {
  children: React.ReactNode;
}

const TourCard = forwardRef<HTMLDivElement, TourCardProps>((props, ref) => {
  const { children, sx, ...rest } = props;
  const base = tourCardStyles();
  const combined = sx ? ([base, sx] as SxProps<Theme>) : base;

  return (
    <Box
      ref={ref}
      sx={combined}
      {...rest}
    >
      {children}
    </Box>
  );
});

TourCard.displayName = 'TourCard';

/** @returns {SxProps<Theme>} */
const tourCardStyles = (): SxProps<Theme> => ({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  padding: '1.5rem',
  borderRadius: '1rem',
  background: undefined as string | undefined,
  color: undefined as string | undefined,
  '&::before': {
    content: '""',
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
    padding: '0.0625rem',
    background: undefined as string | undefined,
    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    WebkitMaskComposite: 'xor',
    maskComposite: 'exclude',
    pointerEvents: 'none',
  },
});

export default memo(TourCard);
export type { TourCardProps };
