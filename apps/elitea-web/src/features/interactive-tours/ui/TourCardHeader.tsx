/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/ui/TourCardHeader.tsx`
 */

import { memo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

export interface TourCardHeaderProps {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  titleId: string;
  children: React.ReactNode;
}

const TourCardHeader = memo((props: TourCardHeaderProps) => {
  const { icon: Icon, titleId, children } = props;
  const styles = tourCardHeaderStyles();

  return (
    <Box sx={styles.wrapper}>
      <Box
        component={Icon}
        sx={styles.icon}
        aria-hidden="true"
        focusable="false"
      />
      <Typography
        id={titleId}
        variant="headingMedium"
        color="text.secondary"
        align="center"
      >
        {children}
      </Typography>
      <Box sx={styles.divider} />
    </Box>
  );
});

TourCardHeader.displayName = 'TourCardHeader';

/** @returns {Record<string, SxProps<Theme>>} */
const tourCardHeaderStyles = (): Record<string, SxProps<Theme>> => ({
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.75rem',
  },
  icon: {
    width: '1.5rem',
    height: '1.5rem',
    flexShrink: 0,
    display: 'block',
  },
  divider: (theme) => ({
    alignSelf: 'stretch',
    height: 0,
    borderBottom: '0.0625rem solid transparent',
    borderImageSlice: 1,
    borderImageSource: theme.vars.palette.background.interactiveTourPrompt.dividerGradient,
  }),
}) as Record<string, SxProps<Theme>>;

export default TourCardHeader;
