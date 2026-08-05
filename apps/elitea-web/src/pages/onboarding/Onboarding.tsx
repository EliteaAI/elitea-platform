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
 *    The back button's visibility mirrors the `user.personal_project_id`
 *    half of the old app's guard (see change 9); the other half —
 *    `location.state?.from` — has no equivalent here: this page reads no
 *    router state, and `src/routes/_shell/onboarding.tsx` (a different
 *    unit's file, outside `src/pages/onboarding/`) doesn't mount this
 *    component yet, so there's no router context to read from regardless.
 *    **Follow-up outside this cluster:** once that route mounts
 *    `Onboarding`, add a second condition using its location state (e.g.
 *    `useRouterState().location.state`), matching `location.state?.from`.
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
 * 8. **Theme tokens (R-T7).**  Every colour now reads `theme.vars.palette.*`
 *    (live CSS var, repaints on scheme change), not `theme.palette.*` (frozen
 *    to the default scheme); `background.onboarding{,Body}`/`boxShadow.onboarding`
 *    are typed on `Palette`/`TypeBackground`, so the old unsafe casts are
 *    gone too. Footer shimmer gradient's fix: see its own `sx` comment.
 *
 * 9. **Welcome/loading guard restored.**  Re-added `!user.personal_project_id
 *    && user.id` on the Welcome screen and the `!user.id` loading branch
 *    (local spinner; old app's `LoadingPage` is out of scope). Both extra
 *    conditions are dead with today's static `MOCK_USER`, by design.
 *
 * 10. **Resume-on-refresh restored.**  Re-added the effect that restarts the
 *    progress/polling intervals on mount when the tour is already showing
 *    and the project isn't ready (e.g. a refresh mid-onboarding) — see that
 *    effect's own comment.
 *
 * 11. **Poll stub resolves instead of no-op-ing forever.**  See the comment
 *    inside `startProgressAndPolling` — the old no-op, plus
 *    `MOCK_USER.personal_project_id` being a `const`, left the wizard's 3rd
 *    screen unreachable through any user action.
 *
 * @public Wave-2 unit A13 surface: consumers mount this page behind a route.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { Box, CircularProgress, IconButton, LinearProgress, Typography } from '@mui/material';

import { FIRST_ELITEA_TOUR_ID, markTourPending } from '@/features/interactive-tours';
import { OnboardingTour, Welcome, WorkspaceIsReady } from '@/features/onboarding';
import { t } from '@/shared/i18n';
import { createStorage } from '@/shared/lib/storage';
import { LogoIcon } from '@/shared/ui/icons/logo-icon';

/** Placeholder user — the real user model will come from the auth provider. */
const MOCK_USER = {
  id: 'mock-user',
  name: 'Developer',
  email: 'dev@elitea.com',
  personal_project_id: '', // blank → walks through the "project ready" flow
} as const;

const ONBOARDING_STORAGE_KEY = 'onboarding_state';
const sessionStore = createStorage('session');

/** Progress bar cap/step; also doubles as the poll stub's readiness check
 *  (change 11 in the file doc comment). */
const PROGRESS_CAP = 95;
const PROGRESS_STEP = 95 / 150;

const Onboarding = memo(() => {
  // Disclosed, not silently dropped: useTrackEvent is unavailable in the new
  // app — no analytics infra yet.
  const progressIntervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queryStatusIntervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [thePrivateProjectIsReady, setThePrivateProjectIsReady] = useState(false);

  // Check if user has clicked "Get Started" button before
  const hasClickedGetStarted = sessionStore.get(ONBOARDING_STORAGE_KEY) === 'true';
  const [showTour, setShowTour] = useState(hasClickedGetStarted || !!MOCK_USER.personal_project_id);
  const [progress, setProgress] = useState(5);
  // Mirrors `progress` so the 5s polling interval can read the latest value
  // without itself becoming an impure state-updater side effect.
  const progressRef = useRef(5);

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
      // Disclosed: markTourPending may be unavailable if interactive-tours is not fully wired.
      // A failure here (e.g. a storage write throwing — Safari private
      // browsing, quota exceeded) must not abort the state transition below:
      // this is a best-effort UI hint, not a precondition for "workspace is
      // ready" actually being ready.
      try {
        if (typeof markTourPending === 'function') {
          markTourPending(FIRST_ELITEA_TOUR_ID);
        }
      } catch {
        // Handled (§3.6): see comment above — best-effort only.
      }
      onClearIntervals();
      setShowTour(true);
      setThePrivateProjectIsReady(true);
      sessionStore.remove(ONBOARDING_STORAGE_KEY);
    },
    [onClearIntervals],
  );

  // Starts the progress/polling intervals if not already running. Shared by
  // `handleShowTour` and the resume-on-refresh effect below, so a fresh
  // click and a reload mid-onboarding start the exact same intervals.
  const startProgressAndPolling = useCallback(() => {
    if (progressIntervalIdRef.current === null) {
      progressIntervalIdRef.current = setInterval(() => {
        setProgress(prev => {
          const next = prev < PROGRESS_CAP ? prev + PROGRESS_STEP : prev;
          progressRef.current = next;
          return next;
        });
      }, 1000);
    }
    if (queryStatusIntervalIdRef.current === null) {
      // Mock "poll until ready" (change 11): the real app polls
      // `useLazyAuthorDetailsQuery` every 5s until the server reports
      // `personal_project_id` (no auth backend to poll yet — change 1). This
      // resolves once the progress bar hits its cap instead, so "workspace
      // is ready" is reachable via a live click-and-wait, not a dead no-op.
      queryStatusIntervalIdRef.current = setInterval(() => {
        if (progressRef.current >= PROGRESS_CAP) {
          handlePersonalProjectReady({ _shouldRefreshProjects: true });
        }
      }, 5000);
    }
  }, [handlePersonalProjectReady]);

  const handleShowTour = useCallback(() => {
    // Disclosed, not silently dropped: useTrackEvent('onboarding_click_get_started')
    // is called by the old page here — analytics gap.
    sessionStore.set(ONBOARDING_STORAGE_KEY, 'true');

    if (!MOCK_USER.personal_project_id) {
      startProgressAndPolling();
    }

    setShowTour(true);
  }, [startProgressAndPolling]);

  const handleJumpIn = () => {
    // Disclosed, not silently dropped: useTrackEvent('onboarding_jump_in') is
    // called by the old page here — analytics gap.
    sessionStore.remove(ONBOARDING_STORAGE_KEY);
    window.location.href = '/chat';
    onClearIntervals();
  };

  useEffect(() => {
    return () => {
      onClearIntervals();
    };
  }, [onClearIntervals]);

  // Resume progress/polling after a refresh mid-onboarding (change 10):
  // sessionStorage still has ONBOARDING_STORAGE_KEY, so `showTour` starts
  // `true` on this mount, but `handleShowTour` never ran in THIS mount to
  // start the intervals — without this effect they'd stall forever after a
  // reload. `startProgressAndPolling` no-ops if already running, so this
  // can't double-start them right after `handleShowTour` itself starts them.
  useEffect(() => {
    if (!MOCK_USER.personal_project_id && showTour && !thePrivateProjectIsReady) {
      startProgressAndPolling();
    }
  }, [showTour, thePrivateProjectIsReady, startProgressAndPolling]);

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
        background: theme.vars.palette.background.default,
        position: 'relative',
      })}
    >
      {!!MOCK_USER.personal_project_id && (
        <IconButton
          onClick={() => window.history.back()}
          sx={styles.backButton}
          aria-label="Go back"
        >
          <ArrowBackIcon />
        </IconButton>
      )}
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
            background: theme.vars.palette.background.onboarding,
            boxShadow: theme.vars.palette.boxShadow.onboarding,
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
              background: theme.vars.palette.background.onboardingBody,
            })}
          >
            {!showTour && !MOCK_USER.personal_project_id && MOCK_USER.id && (
              <Welcome
                name={MOCK_USER.name || MOCK_USER.email}
                onShowTour={handleShowTour}
              />
            )}
            {showTour && <OnboardingTour />}
            {!MOCK_USER.id && (
              <Box sx={styles.loadingContainer}>
                <CircularProgress aria-label={t('pages.onboarding.loadingAriaLabel', 'Loading…')} />
              </Box>
            )}
          </Box>
        </Box>
        {showTour && !thePrivateProjectIsReady && (
          <Box sx={styles.footer}>
            <Box sx={styles.footerHead}>
              <Typography
                sx={theme => {
                  const baseColor = theme.vars.palette.text.secondary;
                  return {
                    color: baseColor,
                    fontWeight: 600,
                    // `baseColor` is now a `var(--el-...)` ref (change 8), so
                    // the old `${baseColor}55` hex-alpha suffix is invalid
                    // CSS here; `transparent` stands in as the faded stop.
                    background: `linear-gradient(90deg, transparent 0%, ${baseColor} 21.15%, transparent 100%)`,
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
                  color: theme.vars.palette.text.secondary,
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
                  backgroundColor: theme.vars.palette.border.lines,
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
  /** Stand-in for the old app's `pages/LoadingPage.jsx` — out of this unit's
   *  `pages/onboarding` scope, and the new app has no shared equivalent yet. */
  loadingContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

export default Onboarding;
