/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/lib/hooks/useInteractiveTourController.hooks.js`
 *
 * Adaptations:
 *  - Replaces react-redux useDispatch / settingsActions with a no-op dispatch
 *    (Redux integration is wired by consumers at app composition time).
 *  - Uses relative imports within `features/interactive-tours/`.
 */

import { useCallback, useReducer, useMemo } from 'react';

import type { TourStep } from '../types';

import {
  AGENT_HUB_TOUR_ID,
  AGENT_TOUR_ID,
  AI_CONFIG_TOUR_ID,
  ANALYTICS_TOUR_ID,
  APPLICATIONS_TOUR_ID,
  ARTIFACT_TOUR_ID,
  CHAT_TOUR_ID,
  CREDENTIALS_TOUR_ID,
  MCP_TOUR_ID,
  NOTIFICATIONS_TOUR_ID,
  PERSONAL_TOKENS_TOUR_ID,
  PIPELINE_TOUR_ID,
  RESOURCES_TOUR_ID,
  SECRETS_TOUR_ID,
  SIDEBAR_TOUR_ID,
  TOOLKIT_TOUR_ID,
  USERS_TOUR_ID,
} from '../constants';
import { initialState, lsCompletedKey, lsPromptKey, tourReducer } from '../helpers';
import { createStorage } from '@/shared/lib/storage';

/** §5.4: tour state must go through the namespaced storage so logout clears it. */
const storage =
  typeof process !== 'undefined' && process.env?.VITEST
    ? // eslint-disable-next-line @typescript-eslint/no-empty-function -- no-op in test env
      { get: (): null => null, set: (): void => {} }
    : createStorage('local');

// ─── Tour step loaders (lazy) ─────────────────────────────────────────────────
const TOUR_LOADERS: Record<string, () => Promise<TourStep[]>> = {
  [APPLICATIONS_TOUR_ID]: () =>
    import('../constants/applicationsTour.constants').then(m => m.applicationsTourSteps),
  [AGENT_HUB_TOUR_ID]: () => import('../constants/agentHubTour.constants').then(m => m.agentHubTourSteps),
  [AI_CONFIG_TOUR_ID]: () =>
    import('../constants/aiConfigurationTour.constants').then(m => m.aiConfigurationTourSteps),
  [ANALYTICS_TOUR_ID]: () => import('../constants/analyticsTour.constants').then(m => m.analyticsTourSteps),
  [CREDENTIALS_TOUR_ID]: () =>
    import('../constants/credentialsTour.constants').then(m => m.credentialsTourSteps),
  [ARTIFACT_TOUR_ID]: () => import('../constants/artifactTour.constants').then(m => m.artifactTourSteps),
  [CHAT_TOUR_ID]: () => import('../constants/chatTour.constants').then(m => m.chatTourSteps),
  [AGENT_TOUR_ID]: () => import('../constants/agentTour.constants').then(m => m.agentTourSteps),
  [NOTIFICATIONS_TOUR_ID]: () =>
    import('../constants/notificationsTour.constants').then(m => m.notificationsTourSteps),
  [PERSONAL_TOKENS_TOUR_ID]: () =>
    import('../constants/personalTokensTour.constants').then(m => m.personalTokensTourSteps),
  [PIPELINE_TOUR_ID]: () => import('../constants/pipelineTour.constants').then(m => m.pipelineTourSteps),
  [SECRETS_TOUR_ID]: () => import('../constants/secretsTour.constants').then(m => m.secretsTourSteps),
  [USERS_TOUR_ID]: () => import('../constants/usersTour.constants').then(m => m.usersTourSteps),
  [MCP_TOUR_ID]: () => import('../constants/mcpTour.constants').then(m => m.mcpTourSteps),
  [SIDEBAR_TOUR_ID]: () => import('../constants/sidebarTour.constants').then(m => m.sidebarTourSteps),
  [RESOURCES_TOUR_ID]: () => import('../constants/resourcesTour.constants').then(m => m.resourcesTourSteps),
  [TOOLKIT_TOUR_ID]: () => import('../constants/toolkitTour.constants').then(m => m.toolkitTourSteps),
};

/**
 * Tour controller state — the stable shape returned by `useInteractiveTourController`.
 */
export interface TourControllerState {
  phase: 'idle' | 'prompt' | 'running' | 'complete';
  tourId: string | null;
  currentStep: TourStep | null;
  stepIndex: number;
  totalSteps: number;
  proposeTour: (id: string) => void;
  startTour: (id: string) => Promise<void>;
  next: () => void;
  back: () => void;
  skip: () => void;
  dismissPrompt: () => void;
  closeComplete: () => void;
}

/**
 * Owns the interactive-tour state machine and side effects (localStorage,
 * lazy step loading). Returns a stable, memoized value to feed into
 * a consumer component.
 *
 * NOTE: Redux dispatch and sidebar-collapse logic is replaced with a no-op
 * in this version; consumers that need those side effects should extend
 * `startTour` or provide their own controller.
 */
export const useInteractiveTourController = (): TourControllerState => {
  const [state, dispatch] = useReducer(tourReducer, initialState);

  const proposeTour = useCallback(
    (id: string) => {
      const seen = storage.get(lsPromptKey(id)) === 'true';
      const completed = storage.get(lsCompletedKey(id)) === 'true';

      if (!seen && !completed) {
        dispatch({ type: 'PROPOSE', tourId: id });
      }
    },
    [],
  );

  const startTour = useCallback(
    async (id: string) => {
      // Mark the prompt as seen immediately so that any re-run of proposeTour
      // (e.g. triggered by a context update) cannot snap the phase back to 'prompt'.
      storage.set(lsPromptKey(id), 'true');

      // NOTE: sidebar-collapse side effect from the legacy app is omitted here;
      // it would require access to the Redux settings slice, which this
      // feature-slice package does not own.

      const steps = (await TOUR_LOADERS[id]?.()) ?? [];
      const activeSteps = steps.filter((step: { skip?: boolean }) => !step.skip);

      if (!activeSteps.length) {
        // Unknown tour id or loader returned no steps — reset to idle rather than
        // getting stuck in 'running' with no currentStep and no UI.
        dispatch({ type: 'SKIP' });
        return;
      }

      dispatch({ type: 'START', tourId: id, steps: activeSteps });
    },
    [dispatch],
  );

  const next = useCallback(() => dispatch({ type: 'NEXT' }), []);
  const back = useCallback(() => dispatch({ type: 'BACK' }), []);
  const skip = useCallback(() => dispatch({ type: 'SKIP' }), []);

  const dismissPrompt = useCallback(() => {
    storage.set(lsPromptKey(state.tourId!), 'true');
    dispatch({ type: 'DISMISS_PROMPT' });
  }, [state.tourId]);

  const closeComplete = useCallback(() => {
    if (state.tourId) {
      storage.set(lsCompletedKey(state.tourId), 'true');
    }

    dispatch({ type: 'CLOSE_COMPLETE' });
  }, [state.tourId]);

  const currentStep = state.steps[state.stepIndex] ?? null;

  return useMemo(
    () => ({
      phase: state.phase,
      tourId: state.tourId,
      currentStep,
      stepIndex: state.stepIndex,
      totalSteps: state.steps.length,
      proposeTour,
      startTour,
      next,
      back,
      skip,
      dismissPrompt,
      closeComplete,
    }),
    [
      state.phase,
      state.tourId,
      state.stepIndex,
      state.steps.length,
      currentStep,
      proposeTour,
      startTour,
      next,
      back,
      skip,
      dismissPrompt,
      closeComplete,
    ],
  );
};
