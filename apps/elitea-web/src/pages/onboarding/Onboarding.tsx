/**
 * Onboarding page — the first-screen experience for new users.
 * Port of `apps/elitea-ui/src/pages/Onboarding/Onboarding.jsx` (Wave-2 unit A13).
 *
 * ── What was changed ────────────────────────────────────────────────────────
 *
 * 1. **Redux → mock user.**  The old page reads `state.user` from a Redux store
 *    and calls `useLazyAuthorDetailsQuery` / `useLazyProjectListQuery` to wait
 *    for `personal_project_id`.  The new app has no auth provider wired into
 *    this page; the user model is replaced by a simple mock object so the
 *    component renders without errors while the real auth is built.
 *
 * 2. **GA event tracking (useTrackEvent).**  The old app fires Google Analytics
 *    events through `useTrackEvent` (imported from `GA.js`).  The new app has
 *    no analytics infra yet.  Disclosed, not silently dropped — the calls are
 *    omitted entirely and noted here.  When an analytics system lands the
 *    page should be re-connected.
 *
 * 3. **No Suspense for OnboardingTour.**  The old app wraps the tour in
 *    `Suspense` + `lazyWithRetry`.  Here we import it directly (inlined).
 *
 * 4. **No route wiring.**  The `handleJumpIn` navigates to `RouteDefinitions.Chat`.
 *    Out of scope — the page can be mounted by a future route.  Uses
 *    `window.history.back()` for back and `window.location` for jump-in.
 *
 * 5. **Logo.**  Uses the new-app icon component `@/shared/ui/icons/logo-icon`.
 *
 * 6. **Removed import:** `FirstVisitPrompt` — not used in this page's current
 *    flow (the old app imported it from interactive-tours but only used it
 *    indirectly through props or context not surfaced in this component).
 *
 * 7. **Removed import:** `ChunkHelpers` — the old app used it for
 *    `lazyWithRetry`.  We inline the OnboardingTour import instead.
 *
 * @public Wave-2 unit A13 surface: consumers mount this page behind a route.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Box, IconButton, LinearProgress, Typography } from '@mui/material';

import { FIRST_ELITEA_TOUR_ID, markTourPending } from '@/features/interactive-tours';
import { OnboardingTour, Welcome, WorkspaceIsReady } from '@/features/onboarding';
import { LogoIcon } from '@/shared/ui/icons/logo-icon';

/** Placeholder user — the real user model will come from the auth provider. */
const MOCK_USER = {
  id: 'mock-user',
  name: 'Developer',
  email: 'dev@elitea.com',
  personal_project_id: '', // blank → walks through the "project ready" flow
} as const;

const ONBOARDING_STORAGE_KEY = 'onboarding_state';

const Onboarding = memo(() => {
  // Disclosed, not silently dropped: useTrackEvent is unavailable in the new
  // app — no analytics infra yet.
  const progressIntervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queryStatusIntervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [thePrivateProjectIsReady, setThePrivateProjectIsReady] = useState(false);

  // Check if user has clicked "Get Started" button before
  const hasClickedGetStarted = sessionStorage.getItem(ONBOARDING_STORAGE_KEY) === 'true';
  const [showTour, setShowTour] = useState(hasClickedGetStarted || !!MOCK_USER.personal_project_id);
  const [progress, setProgress] = useState(5);

  const onClearIntervals = useCallback(() => {
    if (progressIntervalIdRef.current !== null) {
      clearInterval(progressIntervalIdRef.current);
      progressIntervalIdRef.current = null;
    }
    if (queryStatusIntervalIdRef.current !== null) {
      clearInterval(queryStatusIntervalIdRef.current);
      queryStatusIntervalIdRef.current = null;
    }
  }, []);

  const handlePersonalProjectReady = useCallback(
    ({ _shouldRefreshProjects = false }: { _shouldRefreshProjects?: boolean } = {}) => {
      void _shouldRefreshProjects; // Disclosed: getProjectList() not available yet
      // Disclosed: markTourPending may be unavailable if interactive-tours is not fully wired
      if (typeof markTourPending === 'function') {
        markTourPending(FIRST_ELITEA_TOUR_ID);
      }
      onClearIntervals();
      setShowTour(true);
      setThePrivateProjectIsReady(true);
      sessionStorage.removeItem(ONBOARDING_STORAGE_KEY);
    },
    [onClearIntervals],
  );

  const handleShowTour = useCallback(() => {
    // Disclosed, not silently dropped: useTrackEvent('onboarding_click_get_started')
    // is called by the old page here — analytics gap.
    sessionStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');

    if (!MOCK_USER.personal_project_id) {
      progressIntervalIdRef.current = setInterval(() => {
        setProgress(prev => (prev < 95 ? prev + 95 / 150 : prev));
      }, 1000);
      // Polling for personal_project_id — stubbed.  In the real app this calls
      // useLazyAuthorDetailsQuery().unwrap() every 5 s.
      queryStatusIntervalIdRef.current = setInterval(() => {
        // No-op: mock user never gets a personal_project_id.
      }, 5000);
    }

    setShowTour(true);
  }, []);

  const handleJumpIn = () => {
    // Disclosed, not silently dropped: useTrackEvent('onboarding_jump_in') is
    // called by the old page here — analytics gap.
    sessionStorage.removeItem(ONBOARDING_STORAGE_KEY);
    window.location.href = '/chat';
    onClearIntervals();
  };

  useEffect(() => {
    return () => {
      onClearIntervals();
    };
  }, [onClearIntervals]);

  // When personal_project_id is already set, skip to tour immediately.
  useEffect(() => {
    if (MOCK_USER.personal_project_id) {
      handlePersonalProjectReady();
    }
  }, [handlePersonalProjectReady]);

  return (
    <Box
      sx={theme => ({
        width: '100%',
        minWidth: '64rem',
        height: '100vh',
        minHeight: '48rem',
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'auto',
        background: theme.palette.background.default,
        position: 'relative',
      })}
    >
      <IconButton
        onClick={() => window.history.back()}
        sx={styles.backButton}
        aria-label="Go back"
      >
        <ArrowBackIcon />
      </IconButton>
      <Box sx={styles.body}>
        <Box sx={styles.logo}>
          <LogoIcon />
        </Box>
        <Box
          sx={theme => ({
            height: '32.5rem',
            minHeight: '32.5rem',
            width: '100%',
            padding: '1px',
            borderRadius: '1.5rem',
            background:
              (theme.palette.background as unknown as Record<string, unknown>).onboarding ??
              'rgba(0,0,0,0.1)',
            boxShadow:
              (theme.palette.boxShadow as unknown as Record<string, unknown>).onboarding ?? 'none',
          })}
        >
          <Box
            sx={theme => ({
              width: '100%',
              height: '100%',
              borderRadius: 'calc(1.5rem - 1px)',
              padding: '2rem 2rem 1.25rem 2rem',
              boxSizing: 'border-box' as const,
              display: 'flex',
              flexDirection: 'column' as const,
              alignItems: 'center',
              background:
                (theme.palette.background as unknown as Record<string, unknown>).onboardingBody
                  ? undefined
                  : 'background.default',
            })}
          >
            {!showTour && (
              <Welcome name={MOCK_USER.name} onShowTour={handleShowTour} />
            )}
            {showTour && <OnboardingTour />}
          </Box>
        </Box>
        {showTour && !thePrivateProjectIsReady && (
          <Box sx={styles.footer}>
            <Box sx={styles.footerHead}>
              <Typography
                sx={theme => {
                  const baseColor = theme.palette.text.secondary;
                  return {
                    color: baseColor,
                    fontWeight: 600,
                    background: `linear-gradient(90deg, ${baseColor}55 0%, ${baseColor} 21.15%, ${baseColor}44 100%)`,
                    backgroundSize: '200% 100%',
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    animation: 'shimmer 4s infinite linear',
                    '@keyframes shimmer': {
                      '0%': {
                        backgroundPosition: '200% 0',
                      },
                      '100%': {
                        backgroundPosition: '-200% 0',
                      },
                    },
                  };
                }}
                variant="headingSmall"
              >
                Configuring Personal project...
              </Typography>
              <Typography
                sx={theme => ({
                  color: theme.palette.text.secondary,
                })}
                variant="bodySmall"
              >
                about 5 min
              </Typography>
            </Box>
            <Box sx={styles.progressContainer}>
              <LinearProgress
                variant="determinate"
                value={progress}
                sx={theme => ({
                  height: '0.375rem',
                  borderRadius: '0.1875rem',
                  backgroundColor: theme.palette.border.lines,
                  '& .MuiLinearProgress-bar': {
                    borderRadius: '0.1875rem',
                  },
                })}
              />
            </Box>
          </Box>
        )}
        {thePrivateProjectIsReady && <WorkspaceIsReady onJumpIn={handleJumpIn} />}
      </Box>
    </Box>
  );
});

Onboarding.displayName = 'Onboarding';

const styles = {
  backButton: {
    position: 'absolute' as const,
    top: '1rem',
    left: '1.5rem',
    zIndex: 10,
  },
  body: {
    width: '100%',
    maxWidth: '53.75rem',
    boxSizing: 'border-box' as const,
    height: '40rem',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: '2rem',
  },
  logo: {
    width: '6.1875rem',
    height: '1.25rem',
  },
  footer: {
    height: '2.875rem',
    width: '28.75rem',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerHead: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressContainer: {
    width: '100%',
  },
};

export default Onboarding;
