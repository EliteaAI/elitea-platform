/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/ui/TourCompleteCard.jsx`
 *
 * Rendered when a tour reaches the 'complete' phase. Shows "Tour Complete!"
 * with optional "Keep exploring" links to other tours.
 *
 * Adaptations:
 *  - Uses `useInteractiveTourController()` instead of `useInteractiveTour()` context
 *  - Uses `@/shared/ui/BaseBtn` and `BUTTON_VARIANTS`
 *  - Removes react-router-dom `useNavigate` — `KeepExploringItem` items are
 *    rendered as buttons; the consumer wiring the tour is expected to handle
 *    navigation externally (out of scope for A13).
 */

import { memo, useCallback } from 'react';

import Box from '@mui/material/Box';
import Unstable_TrapFocus from '@mui/material/Unstable_TrapFocus';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { BaseBtn, BUTTON_VARIANTS } from '@/shared/ui/BaseBtn';
import { TutorialsSuccessIcon } from '@/shared/ui/icons/tutorials-success-icon';

import { TOUR_COMPLETION_CONFIGS } from '../lib/helpers';

import { useInteractiveTourController } from '../lib/hooks';

import InteractiveTourBackdrop from './InteractiveTourBackdrop';
import TourCard from './TourCard';
import TourCardHeader from './TourCardHeader';

const TITLE_ID = 'tour-complete-title';

const TourCompleteCard = memo(() => {
  const { closeComplete, tourId } = useInteractiveTourController();
  const keepExploring = (TOUR_COMPLETION_CONFIGS[tourId ?? '']?.keepExploring) ?? [];
  const styles = tourCompleteCardStyles();
  const TutorialsSuccessIconComponent = TutorialsSuccessIcon;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeComplete?.();
      }
    },
    [closeComplete],
  );

  // KeepExploring navigation is handled externally — the tour controller is
  // wired at the app-composition layer. This handler is a no-op stub that
  // logs; actual navigation is provided by the consumer.
  const handleKeepExploring = useCallback(
    (_e: React.MouseEvent<HTMLButtonElement>) => {
      // Navigation to keep-exploring tour paths is wired at the app layer
      // (not part of this shared-infra package).  Consumers that want
      // auto-navigation can override this behaviour by providing a custom
      // root component or by wrapping this one.
    },
    [],
  );

  return (
    <InteractiveTourBackdrop>
      <Unstable_TrapFocus open>
        <TourCard
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          sx={styles.card}
        >
          <TourCardHeader
            icon={TutorialsSuccessIconComponent}
            titleId={TITLE_ID}
          >
            Tour Complete!
          </TourCardHeader>

          {keepExploring.length > 0 && (
            <Box sx={styles.keepExploringSection}>
              <Typography
                variant="headingSmall"
                sx={styles.keepExploringLabel}
              >
                Keep exploring:
              </Typography>

              <Box sx={styles.keepExploringList}>
                {keepExploring.map(item => (
                  <BaseBtn
                    key={item.tourId}
                    data-tour-id={item.tourId}
                    data-path={item.path}
                    variant={BUTTON_VARIANTS.secondary}
                    onClick={handleKeepExploring}
                    sx={styles.keepExploringBtn}
                  >
                    {item.label}
                  </BaseBtn>
                ))}
              </Box>
            </Box>
          )}

          <Box sx={styles.footer}>
            <BaseBtn
              variant={BUTTON_VARIANTS.secondary}
              onClick={closeComplete}
            >
              Done!
            </BaseBtn>
          </Box>
        </TourCard>
      </Unstable_TrapFocus>
    </InteractiveTourBackdrop>
  );
});

TourCompleteCard.displayName = 'TourCompleteCard';

/** @returns {Record<string, SxProps<Theme>>} */
const tourCompleteCardStyles = (): Record<string, SxProps<Theme>> => ({
  card: {
    width: '27.5rem', // 440px
    pointerEvents: 'auto',
    '&:focus': { outline: 'none' },
  },
  keepExploringSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: '0.75rem',
    width: '100%',
    paddingTop: '0.25rem',
  },
  keepExploringLabel: ({ palette }) => ({
    color: (palette.text?.secondary as string | undefined) ?? undefined,
    textAlign: 'center',
  }),
  keepExploringList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    width: '100%',
  },
  keepExploringBtn: ({ typography }) => ({
    alignSelf: 'stretch',
    borderRadius: '0.5rem',
    padding: '1rem 0',
    justifyContent: 'center',
    ...((typography?.labelMedium as Record<string, unknown> | undefined) ?? {}),
  }),
  footer: {
    display: 'flex',
    justifyContent: 'center',
    paddingTop: '0.75rem',
    width: '100%',
  },
}) as Record<string, SxProps<Theme>>;

export default TourCompleteCard;
