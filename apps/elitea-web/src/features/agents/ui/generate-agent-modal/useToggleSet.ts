import { useCallback, useState } from 'react';

export interface UseToggleSetResult<Id> {
  readonly selectedIds: ReadonlySet<Id>;
  readonly toggle: (id: Id) => void;
  readonly reset: () => void;
}

/**
 * A `Set<Id>` with a stable `toggle`/`reset` pair — the baseline's
 * `GenerateAgentModal.jsx` repeats this exact `useState(new Set())` +
 * toggle-callback pattern five times (`handleToggleToolkit`,
 * `handleToggleAgent`, `handleToggleMcp`, `handleTogglePipeline`,
 * `handleToggleSkill`, lines 50-99). Factored into one hook so
 * `GenerateAgentModal.tsx` calls it five times instead of hand-writing the
 * same `useState`/`useCallback` pair five times over.
 */
export function useToggleSet<Id>(): UseToggleSetResult<Id> {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<Id>>(new Set());

  const toggle = useCallback((id: Id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  return { selectedIds, toggle, reset };
}
