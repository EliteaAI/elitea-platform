import { useCallback, useState } from 'react';

import { useIndexesStore, mergeIndexesOverlay, type IndexRow } from '../../model/indexesStore';

/**
 * Port of `apps/elitea-ui/src/[fsd]/features/toolkits/indexes/lib/hooks/
 * useIndexNameValidation.hooks.js` (unit A4a). The baseline reads
 * `selectIndexesList` (Redux) for the existing-names check; this app has no
 * Redux, so the equivalent live list is `serverIndexes` (the caller's
 * `useIndexesListQuery(...).data ?? []`) overlaid with this slice's own
 * `tempIndexes`/`indexPatches` (`../../model/indexesStore.ts`'s
 * `mergeIndexesOverlay`) — the same overlay `IndexesContainer.tsx` applies
 * for display, so "is this name already taken" sees exactly the rows the
 * user sees, including a locally-added-but-not-yet-server-confirmed index.
 */
export interface UseIndexNameValidationResult {
  readonly indexNameError: string | null;
  readonly clearIndexNameError: () => void;
  readonly updateIndexNameError: (name: string) => void;
  readonly isIndexNameValid: (name: string) => boolean;
}

export function useIndexNameValidation(serverIndexes: readonly IndexRow[] = []): UseIndexNameValidationResult {
  const tempIndexes = useIndexesStore((state) => state.tempIndexes);
  const indexPatches = useIndexesStore((state) => state.indexPatches);

  const [indexNameError, setIndexNameError] = useState<string | null>(null);

  const clearIndexNameError = useCallback(() => setIndexNameError(null), []);

  const updateIndexNameError = useCallback((name: string) => setIndexNameError(`Index "${name}" already exists`), []);

  const isIndexNameValid = useCallback(
    (name: string) => {
      const indexesList = mergeIndexesOverlay(serverIndexes, tempIndexes, indexPatches);
      return !indexesList.some((idx) => idx.metadata['collection'] === name);
    },
    [serverIndexes, tempIndexes, indexPatches],
  );

  return { indexNameError, clearIndexNameError, updateIndexNameError, isIndexNameValid };
}
