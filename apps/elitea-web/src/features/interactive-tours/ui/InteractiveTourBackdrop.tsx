/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/ui/InteractiveTourBackdrop.jsx`
 */

import { memo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

interface InteractiveTourBackdropProps {
  children: React.ReactNode;
}

const InteractiveTourBackdrop = memo((props: InteractiveTourBackdropProps) => {
  const { children } = props;
  const styles = backdropStyles();

  return <Box sx={styles.backdrop}>{children}</Box>;
});

InteractiveTourBackdrop.displayName = 'InteractiveTourBackdrop';

/** @returns {Record<string, SxProps<Theme>>} */
const backdropStyles = (): Record<string, SxProps<Theme>> => ({
  backdrop: ({ palette, zIndex }) => ({
    position: 'fixed',
    inset: 0,
    zIndex: (zIndex.modal as number) + 1,
    backgroundColor: palette.background?.interactiveTourPrompt?.backdrop,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'auto',
  }),
}) as Record<string, SxProps<Theme>>;

export default InteractiveTourBackdrop;
