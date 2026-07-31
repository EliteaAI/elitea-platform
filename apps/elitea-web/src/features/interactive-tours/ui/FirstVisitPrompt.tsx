/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/ui/FirstVisitPrompt.jsx`
 *
 * Adaptations:
 *  - Uses `@/shared/ui/BaseBtn` and `BUTTON_VARIANTS`
 *  - Uses `@/shared/ui/icons/tutorials-prompt-icon` for the icon
 *  - Props-driven: `phase`, `tourId`, `onSkip`, `onStart`
 *    (the old `useInteractiveTour` context is already dropped per A13 scope)
 */

import { memo, useCallback } from 'react';

import Box from '@mui/material/Box';
import Unstable_TrapFocus from '@mui/material/Unstable_TrapFocus';
import Typography from '@mui/material/Typography';

import type { SxProps, Theme } from '@mui/material/styles';

import { BaseBtn, BUTTON_VARIANTS } from '@/shared/ui/BaseBtn';
import { TutorialsPromptIcon } from '@/shared/ui/icons/tutorials-prompt-icon';

import TourCard from './TourCard';
import TourCardHeader from './TourCardHeader';

import InteractiveTourBackdrop from './InteractiveTourBackdrop';

const TITLE_ID = 'first-visit-prompt-title';
const DESCRIPTION_ID = 'first-visit-prompt-description';

const BODY_COPY =
  'Take a short interactive tour to learn how this section works and discover its key features.';

interface FirstVisitPromptProps {
  onSkip?: () => void;
  onStart?: () => void;
  sx?: SxProps<Theme>;
}

const FirstVisitPrompt = memo((props: FirstVisitPromptProps) => {
  const { onSkip, onStart, sx } = props;
  const styles = firstVisitPromptStyles();
  // TutorialsPromptIcon is already a single merged icon (dark+light merged into one)
  // using fill="currentColor" that follows the theme palette automatically.
  const TutorialsPromptIconComponent = TutorialsPromptIcon;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSkip?.();
      }
    },
    [onSkip],
  );

  return (
    <InteractiveTourBackdrop>
      <Unstable_TrapFocus open>
        <TourCard
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
          aria-describedby={DESCRIPTION_ID}
          onKeyDown={handleKeyDown}
          sx={[styles.card, ...(Array.isArray(sx) ? sx : [sx]).filter(Boolean)]}
        >
          <TourCardHeader
            icon={TutorialsPromptIconComponent}
            titleId={TITLE_ID}
          >
            New here?
          </TourCardHeader>

          <Box sx={styles.body}>
            <Typography
              id={DESCRIPTION_ID}
              variant="headingSmall"
              color="text.secondary"
              align="center"
            >
              {BODY_COPY}
            </Typography>
          </Box>

          <Box sx={styles.footer}>
            <BaseBtn
              variant={BUTTON_VARIANTS.secondary}
              onClick={onSkip}
            >
              Skip
            </BaseBtn>
            <BaseBtn
              variant={BUTTON_VARIANTS.contained}
              onClick={onStart}
            >
              Start!
            </BaseBtn>
          </Box>
        </TourCard>
      </Unstable_TrapFocus>
    </InteractiveTourBackdrop>
  );
});

FirstVisitPrompt.displayName = 'FirstVisitPrompt';

/** @returns {Record<string, import('@mui/material/styles').SxProps<import('@mui/material/styles').Theme>>} */
const firstVisitPromptStyles = (): Record<string, import('@mui/material/styles').SxProps<import('@mui/material/styles').Theme>> => ({
  card: {
    position: 'relative',
    alignItems: 'stretch',
    width: '27.5rem', // 440px
    pointerEvents: 'auto',
    '&:focus': { outline: 'none' },
  },
  body: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: '0.75rem',
  },
  footer: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: '0.75rem',
    gap: '0.75rem',
  },
});

export default FirstVisitPrompt;
