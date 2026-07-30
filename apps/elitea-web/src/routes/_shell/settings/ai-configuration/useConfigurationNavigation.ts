/**
 * Configuration navigation hook — provides routing to configuration editor.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/lib/hooks/useConfigurationNavigation.hooks.js`.
 */
import { useCallback, useMemo } from 'react';

import { useLocation, useNavigate } from '@tanstack/react-router';

export function useConfigurationNavigation() {
  const navigate = useNavigate();
  const { state } = useLocation();

  const locationState = useMemo(
    () =>
      (state as { routeStack?: Array<{ breadCrumb: string; pagePath: string }> } | null)
        ?.routeStack ||
      [],
    [state],
  );

  const navigateToConfiguration = useCallback(
    (configurationId: string) => {
      void navigate({
        to: '/settings/create-configuration',
        search: { from: 'model-configuration' },
        state: {
          routeStack: [
            ...locationState,
            {
              breadCrumb: 'AI Configuration',
              pagePath: '/settings/model-configuration',
            },
            {
              breadCrumb: 'New Configuration',
              pagePath: `/settings/create-configuration/${configurationId}`,
            },
          ],
        } as Record<string, unknown>,
      });
    },
    [navigate, locationState],
  );

  return { navigateToConfiguration };
}
