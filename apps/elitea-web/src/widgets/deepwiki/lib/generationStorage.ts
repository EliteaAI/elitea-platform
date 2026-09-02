/**
 * Where a running generation is remembered between page loads (DWIKI-006).
 *
 * The legacy bundle kept `{ taskId, status, message, startTime }` under
 * `deepwiki.generation.{project}.{toolkit}` on the bare `localStorage`, with a
 * FOUR-HOUR TTL: a stored run older than that was discarded on load rather than
 * resumed (DeepWikiApp.jsx:542-560). Both rules are kept. The TTL is what stops
 * a generation that died with the tab from being shown as running for ever.
 *
 * THE NAMESPACE is the change: a raw key survives sign-out, and the next user
 * of the machine would land on the previous user's running generation (#22).
 * `createStorage` puts it inside the sweep.
 */
import { createStorage } from '@/shared/lib/storage';

const store = createStorage('local');

/** The legacy TTL, unchanged: `4 * 60 * 60 * 1000`. */
export const GENERATION_STATE_TTL_MS = 4 * 60 * 60 * 1000;

export interface StoredGeneration {
  /** The facade's invocation id — what a reload polls to resume. */
  readonly invocationId: string;
  /** When the run started, so the TTL can be applied on load. */
  readonly startedAt: number;
}

function keyFor(projectId: string | number, toolkitId: string | number): string {
  return `deepwiki.generation.${String(projectId)}.${String(toolkitId)}`;
}

function isStored(value: unknown): value is StoredGeneration {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoredGeneration).invocationId === 'string' &&
    (value as StoredGeneration).invocationId !== '' &&
    typeof (value as StoredGeneration).startedAt === 'number'
  );
}

export interface GenerationStorage {
  readonly load: () => StoredGeneration | null;
  readonly save: (state: StoredGeneration) => void;
  readonly clear: () => void;
}

export function createGenerationStorage(
  projectId: string | number,
  toolkitId: string | number,
  now: () => number = Date.now,
): GenerationStorage {
  const key = keyFor(projectId, toolkitId);
  return {
    load: () => {
      const stored = store.getJSON<StoredGeneration>(key, (raw) =>
        isStored(raw) ? raw : (undefined as never),
      );
      if (stored === null) return null;
      // Expired is discarded AND removed: leaving it would re-run this check on
      // every load, and a stale entry is not a fact worth keeping.
      if (now() - stored.startedAt >= GENERATION_STATE_TTL_MS) {
        store.remove(key);
        return null;
      }
      return stored;
    },
    save: (state) => {
      store.setJSON(key, state);
    },
    clear: () => {
      store.remove(key);
    },
  };
}
