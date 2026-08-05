/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/ui/InteractiveTourSpotlight.tsx`
 */

import { memo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

interface InteractiveTourSpotlightProps {
  targetRect: DOMRect | null;
  borderRadius?: string | undefined;
}

const SPOTLIGHT_PADDING = 10;
const BORDER_WIDTH_PX = 2;

const InteractiveTourSpotlight = memo((props: InteractiveTourSpotlightProps) => {
  const { targetRect, borderRadius } = props;
  const hasTarget = !!targetRect;

  return (
    <>
      <Box sx={blockerSx(hasTarget)} />
      {hasTarget && (
        <Box sx={spotlightSx(targetRect, borderRadius ?? '0.75rem')} />
      )}
    </>
  );
});

InteractiveTourSpotlight.displayName = 'InteractiveTourSpotlight';

/** @returns {SxProps<Theme>} */
const blockerSx =
  (hasTarget: boolean): SxProps<Theme> =>
  ({ palette, zIndex }) => ({
    position: 'fixed',
    inset: 0,
    zIndex: (zIndex.modal as number) + 1,
    pointerEvents: 'auto',
    backgroundColor: hasTarget ? 'transparent' : (palette.background?.interactiveTourPrompt?.backdrop as string | undefined) ?? undefined,
  });

/** @returns {SxProps<Theme>} */
const spotlightSx =
  (targetRect: DOMRect, borderRadius: string): SxProps<Theme> =>
  ({ palette, zIndex }) => ({
    position: 'fixed',
    top: targetRect.top - SPOTLIGHT_PADDING,
    left: targetRect.left - SPOTLIGHT_PADDING,
    width: targetRect.width + SPOTLIGHT_PADDING * 2,
    height: targetRect.height + SPOTLIGHT_PADDING * 2,
    borderRadius,
    zIndex: (zIndex.modal as number) + 2,
    pointerEvents: 'none',
    background: 'transparent',
    transition:
      'top 0.35s cubic-bezier(0.4, 0, 0.2, 1), left 0.35s cubic-bezier(0.4, 0, 0.2, 1), width 0.35s cubic-bezier(0.4, 0, 0.2, 1), height 0.35s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
    boxShadow: `0 0 0 9999px ${(palette.background?.interactiveTourPrompt?.backdrop as string | undefined) ?? undefined}`,
    '&::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      // oxlint-disable-next-line elitea/ad-hoc-radius -- 'inherit' is a CSS keyword (not ad-hoc), required so the mask overlay matches the spotlight's token radius
      borderRadius: 'inherit',
      padding: `${BORDER_WIDTH_PX}px`,
      background: (palette.background?.interactiveTourPrompt?.borderGradient as string | undefined) ?? undefined,
      WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)', /* oxlint-disable elitea/no-raw-color -- #fff is transparent mask color, not a visible UI color */
      WebkitMaskComposite: 'xor',
      mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)', /* oxlint-disable elitea/no-raw-color -- #fff is transparent mask color, not a visible UI color */
      maskComposite: 'exclude',
    },
  });

export default InteractiveTourSpotlight;
