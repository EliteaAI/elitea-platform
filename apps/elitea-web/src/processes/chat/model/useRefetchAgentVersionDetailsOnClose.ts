/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/
 * useRefetchAgentVersionDetailsOnClose.js` — when an agent-chat panel closes
 * (or its editor closes), refetch the agent's version details IF something
 * elsewhere flagged that they're stale (`shouldRefetchDetails`), then clear
 * the flag.
 *
 * Reuses `features/agents`'s already-landed `useApplicationsStore`
 * (`shouldRefetchDetails`/`setShouldRefetchDetails`) directly — the SAME
 * underlying flag the baseline's Redux `state.applications.shouldRefetchDetails`
 * ported onto (A1a sub-unit, `features/agents/model/applicationsStore.ts`).
 * `processes/` may legally import `features/` (R-L1: imports flow downward),
 * and this store is now barrel-exported from `features/agents/index.ts` (a
 * small, purely-additive export added by this unit alongside this file —
 * see that barrel's own updated doc comment).
 */
import { useCallback } from 'react';

import { useApplicationsStore } from '@/features/agents';

export interface UseRefetchAgentVersionDetailsOnCloseParams {
  readonly refetchVersionDetails?: () => void;
}

export interface UseRefetchAgentVersionDetailsOnCloseResult {
  readonly refetchAgentVersionDetailsOnClose: () => void;
}

export function useRefetchAgentVersionDetailsOnClose(
  params: UseRefetchAgentVersionDetailsOnCloseParams,
): UseRefetchAgentVersionDetailsOnCloseResult {
  const { refetchVersionDetails } = params;
  const shouldRefetchDetails = useApplicationsStore((s) => s.shouldRefetchDetails);
  const setShouldRefetchDetails = useApplicationsStore((s) => s.setShouldRefetchDetails);

  const refetchAgentVersionDetailsOnClose = useCallback(() => {
    if (shouldRefetchDetails) {
      refetchVersionDetails?.();
      setShouldRefetchDetails(false);
    }
  }, [shouldRefetchDetails, refetchVersionDetails, setShouldRefetchDetails]);

  return { refetchAgentVersionDetailsOnClose };
}
