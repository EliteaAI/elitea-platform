/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/ui/InteractiveTourRoot.jsx`
 *
 * Root orchestrator for the interactive tour UI. Renders the appropriate
 * component based on the tour controller's `phase`:
 *
 * - `prompt` → FirstVisitPrompt (ask user to start)
 * - `running` → InteractiveTourCard (show steps)
 * - `complete` → TourCompleteCard (show completion)
 * - `idle` → null (nothing to render)
 *
 * Adaptations:
 *  - Uses `useInteractiveTourController()` instead of `useInteractiveTour()`
 *    context (already dropped per A13 scope).
 */

import { memo } from 'react';

import { useInteractiveTourController } from '../lib/hooks';

import FirstVisitPrompt from './FirstVisitPrompt';
import InteractiveTourCard from './InteractiveTourCard';
import TourCompleteCard from './TourCompleteCard';

const InteractiveTourRoot = memo(() => {
  const controller = useInteractiveTourController();
  const { phase, tourId, dismissPrompt, startTour } = controller;

  if (phase === 'prompt') {
    return (
      <FirstVisitPrompt
        onSkip={dismissPrompt}
        onStart={() => startTour(tourId!)}
      />
    );
  }

  if (phase === 'running') {
    return <InteractiveTourCard />;
  }

  if (phase === 'complete') {
    return <TourCompleteCard />;
  }

  return null;
});

InteractiveTourRoot.displayName = 'InteractiveTourRoot';

export default InteractiveTourRoot;
