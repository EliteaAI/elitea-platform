/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/lib/hooks/useTourFromUrl.hooks.js`
 *
 * Adaptations:
 *  - Replaces react-router-dom `useSearchParams` with TanStack Router
 *    equivalents. The caller is responsible for invoking this hook inside
 *    a route component that has access to the router instance.
 *  - Because this is shared infrastructure (not wired into routes yet),
 *    we expose a type that callers can adapt to their router.
 *
 * NOTE: Per issue #26, tour-specific hooks integration (useTourFromUrl,
 * useInteractiveTour, data-tour attributes) is dropped for the A13 scope.
 * This hook is ported faithfully for future wiring by Onboarding /
 * HelpCenter clusters that consume this infrastructure.
 */

import { useEffect, useRef } from 'react';

/**
 * Minimal shape of a TanStack Router search-parameter helper.
 * Consumers should adapt this to their actual router type.
 */
export interface SearchParamsHandle {
  getSearchParams: () => URLSearchParams;
  setSearchParams: (fn: (prev: URLSearchParams) => URLSearchParams, options?: { replace?: boolean }) => void;
}

/**
 * Controller interface for starting tours. Consumed from the tour
 * controller context or passed directly.
 */
export interface TourStartHandle {
  startTour?: (tourId: string) => void | Promise<void>;
}

/**
 * Reads a `?tour=<tourId>` search-param from the URL and auto-starts
 * the tour. Consumes the param once (using a ref to avoid repeated
 * starts on re-renders) and removes the param from the URL.
 *
 * This hook is self-contained — it does NOT require a context provider.
 * Callers should pass `searchParams` and `startTour` explicitly rather
 * than importing from a context module (already dropped per A13 scope).
 */
export const useTourFromUrl = (searchParams: SearchParamsHandle, startTour: TourStartHandle): void => {
  const consumedTourRef = useRef<string | null>(null);

  useEffect(() => {
    const tourId = searchParams.getSearchParams().get('tour');

    if (!tourId) {
      consumedTourRef.current = null;
      return;
    }

    if (consumedTourRef.current === tourId) return;

    consumedTourRef.current = tourId;
    startTour.startTour?.(tourId);
    searchParams.setSearchParams(
      params => {
        const nextParams = new URLSearchParams(params);

        nextParams.delete('tour');

        return nextParams;
      },
      { replace: true },
    );
  }, [searchParams, startTour]);
};
