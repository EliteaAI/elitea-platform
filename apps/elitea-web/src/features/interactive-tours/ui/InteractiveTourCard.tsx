/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/ui/InteractiveTourCard.jsx`
 *
 * The main tour step card: renders the current step title, markdown content,
 * and navigation buttons. Uses `useTourCardPosition` for positioning and
 * `useInteractiveTourController` for state management.
 *
 * Adaptations:
 *  - Uses `@/shared/ui/Markdown` instead of `mui-markdown`
 *  - Uses `useInteractiveTourController()` instead of context
 *  - Uses `@/shared/ui/BaseBtn` and `BUTTON_VARIANTS`
 */

import { memo, useCallback, useEffect, useRef } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { Markdown } from '@/shared/ui/Markdown';

import { BaseBtn, BUTTON_VARIANTS } from '@/shared/ui/BaseBtn';
import { keyframes } from '@emotion/react';

import { CARD_WIDTH_PX } from '../lib/constants';
import { useInteractiveTourController, useTourCardPosition } from '../lib/hooks';

import InteractiveTourSpotlight from './InteractiveTourSpotlight';
import TourCard from './TourCard';

// Fade-in animation played whenever the step content is mounted (key={stepIndex})
const stepFadeIn = keyframes({
  from: { opacity: 0, transform: 'translateY(0.375rem)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const InteractiveTourCard = memo(() => {
  const controller = useInteractiveTourController();
  const { phase, currentStep, stepIndex, totalSteps, next, back, skip } = controller;
  const styles = tourCardStyles();
  const { targetInfo, cardPositionSx, cardBodySx } = useTourCardPosition(currentStep);
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === totalSteps - 1;

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const primaryActionRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Capture the focused element when the tour starts, move focus to the primary
  // action on each step, and restore the original focus when the tour ends.
  useEffect(() => {
    if (!currentStep) {
      previousFocusRef.current?.focus?.();
      previousFocusRef.current = null;
      return;
    }
    if (!previousFocusRef.current) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    }
    primaryActionRef.current?.focus?.() /* oxlint-disable typescript/no-non-null-asserted-optional-chain -- baseline port: fallback to dialog focus when primary action has no focus method */ ?? dialogRef.current?.focus();
  }, [currentStep]);

  /** Cycle focus between first/last focusable elements in the dialog. */
  const cycleFocusInDialog = useCallback(
    (focusable: HTMLElement[], forward: boolean) => {
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (forward && document.activeElement === last) {
        last.focus();
      } else if (!forward && document.activeElement === first) {
        first.focus();
      }
    },
    [],
  );

  // Keep Tab/Shift+Tab cycling within the dialog while the tour is active and
  // allow keyboard step navigation without requiring pointer interaction.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (e.key === 'Tab') {
        cycleFocusInDialog(focusable as HTMLElement[], !e.shiftKey);
        return;
      }

      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
        return;
      }

      if (e.key === 'ArrowLeft') {
        if (!isFirstStep) {
          e.preventDefault();
          back();
        }
        return;
      }

      if (e.key === 'Enter' && document.activeElement === dialogRef.current) {
        e.preventDefault();
        next();
      }
    },
    [back, isFirstStep, next],
  );

  if (phase !== 'running' || !currentStep) return null;

  return (
    <>
      <InteractiveTourSpotlight
        targetRect={targetInfo?.rect ?? null}
        borderRadius={targetInfo?.borderRadius}
      />

      <TourCard
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={currentStep.title || 'Interactive tour'}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        sx={([styles.card, cardPositionSx as SxProps<Theme>] as SxProps<Theme>)}
      >
        <Box
          key={stepIndex}
          sx={styles.stepContent}
        >
          {currentStep.title && (
            <Typography variant="headingMedium">{currentStep.title}</Typography>
          )}

          <Box sx={([styles.body, cardBodySx as unknown as SxProps<Theme>] as SxProps<Theme>)}>
            <Markdown>{currentStep.content}</Markdown>
          </Box>
        </Box>

        <Box sx={styles.footer}>
          <Typography
            variant="labelSmall"
            sx={styles.counter}
          >
            {stepIndex + 1} / {totalSteps}
          </Typography>

          <Box sx={styles.footerButtons}>
            <BaseBtn
              variant={BUTTON_VARIANTS.tertiary}
              onClick={skip}
            >
              Skip
            </BaseBtn>
            <BaseBtn
              variant={BUTTON_VARIANTS.secondary}
              disabled={isFirstStep}
              onClick={back}
            >
              Back
            </BaseBtn>
            <BaseBtn
              variant={BUTTON_VARIANTS.contained}
              ref={primaryActionRef}
              onClick={next}
            >
              {isLastStep ? 'Finish' : 'Next'}
            </BaseBtn>
          </Box>
        </Box>
      </TourCard>
    </>
  );
});

InteractiveTourCard.displayName = 'InteractiveTourCard';

/** @returns {Record<string, SxProps<Theme>>} */
const tourCardStyles = (): Record<string, SxProps<Theme>> => ({
  card: ({ zIndex }) => ({
    outline: 0, // programmatic focus target; outline is on inner focusable elements
    position: 'fixed',
    zIndex: (zIndex.modal as number) + 3,
    width: `${CARD_WIDTH_PX / 16}rem`,
    maxWidth: '90vw',
    maxHeight: '80vh',
    overflow: 'hidden',
    // Smooth slide when the card repositions between steps
    transition: [
      'top 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
      'left 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
      'bottom 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
      'right 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
      'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
    ].join(', '),
  }),
  stepContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    flex: 1,
    minHeight: 0,
    animation: `${stepFadeIn} 0.25s ease forwards`,
  },
  body: {
    typography: 'bodyMedium',
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
  },
  footer: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: '0.5rem',
  },
  counter: ({ palette }) => ({
    color: (palette.background?.interactiveTourPrompt?.counter as string | undefined) ?? undefined,
  }),
  footerButtons: {
    display: 'flex',
    flexDirection: 'row',
    gap: '0.5rem',
    alignItems: 'center',
  },
}) as Record<string, SxProps<Theme>>;

export default InteractiveTourCard;
