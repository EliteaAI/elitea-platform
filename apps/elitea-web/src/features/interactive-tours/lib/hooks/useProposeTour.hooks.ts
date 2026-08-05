/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/lib/hooks/useProposeTour.hooks.js`
 *
 * Adaptations:
 *  - Removed the `useInteractiveTour` Context hook (already dropped per issue #26).
 *  - `markTourPending` stays — it is used by consumers as a standalone utility.
 */

import { createStorage } from '@/shared/lib/storage';

/** §5.4: tour state must go through the namespaced storage so logout clears it. */
let storage: ReturnType<typeof createStorage>;
try {
  storage = createStorage('local');
} catch {
  storage = ({ set: (): void => {} } as unknown) as ReturnType<typeof createStorage>;
}

/**
 * Persist a "pending tour" flag in namespaced storage under the key
 * `interactive-tour:<tourId>:pending`. Consumers that read this flag
 * should use `useProposePendingTour` to trigger the tour on mount.
 */
export const markTourPending = (tourId: string | null | undefined): void => {
  if (!tourId) return;

  storage.set(`interactive-tour:${tourId}:pending`, 'true');
};
