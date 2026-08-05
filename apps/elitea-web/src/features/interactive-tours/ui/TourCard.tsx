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
  borderRadius: '1rem', /* oxlint-disable elitea/ad-hoc-radius -- Wave-2 prototype: ad-hoc radii from ported baseline; REMOVAL: S8 + token pass */
  background: undefined as string | undefined,
  color: undefined as string | undefined,
  '&::before': {
    content: '""',
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit', /* oxlint-disable elitea/ad-hoc-radius -- 'inherit' is CSS keyword, not ad-hoc; required for mask overlay */
    padding: '0.0625rem',
    background: undefined as string | undefined,
    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)', /* oxlint-disable elitea/no-raw-color -- #fff is transparent mask color, not a visible UI color */
    WebkitMaskComposite: 'xor',
    maskComposite: 'exclude',
    pointerEvents: 'none',
  },
});

export default memo(TourCard);
