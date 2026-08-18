/**
 * Composes `selectedProject.store.ts` with `../lib/selectedProjectPersistence.ts`:
 * hydrates from storage once on mount (same reasoning as `widgets/sidebar`'s
 * `Sidebar.tsx` does for the collapsed flag — reading storage inside the
 * module-scope store creator is unsafe under vitest's test environment), and
 * every `selectProject` call persists immediately.
 */
import { useCallback, useEffect } from 'react';

import { readPersistedProject, writePersistedProject } from '@/shared/lib/selectedProjectPersistence';
import { useSelectedProjectStore, type SelectedProject } from './selectedProject.store';

export interface UseSelectedProjectResult {
  readonly project: SelectedProject | null;
  readonly selectProject: (id: string, name: string) => void;
}

export function useSelectedProject(): UseSelectedProjectResult {
  const project = useSelectedProjectStore((state) => state.project);
  const setProject = useSelectedProjectStore((state) => state.setProject);

  useEffect(() => {
    if (project !== null) return;
    const persisted = readPersistedProject();
    if (persisted !== null) setProject(persisted);
    // Runs once per mount, re-checked only if a selection is later cleared
    // (never happens today — no "clear selection" action exists — kept
    // dependency-correct rather than an empty array for that reason).
  }, [project, setProject]);

  const selectProject = useCallback(
    (id: string, name: string) => {
      writePersistedProject({ id, name });
      setProject({ id, name });
    },
    [setProject],
  );

  return { project, selectProject };
}
