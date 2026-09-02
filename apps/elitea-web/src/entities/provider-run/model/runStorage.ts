import { createStorage } from '@/shared/lib/storage';

/** The run a reload resumes: the facade's invocation id and when it started. */
interface StoredRun {
  readonly invocationId: string;
  readonly startedAt: number;
}

export interface RunStorage {
  /** The stored run, or null when there is none or it is older than the TTL. */
  readonly load: () => StoredRun | null;
  readonly save: (run: StoredRun) => void;
  readonly clear: () => void;
}

export interface RunStorageOptions {
  /** The namespaced key, e.g. `deepwiki.generation.{project}.{toolkit}`. */
  readonly key: string;
  /** A run older than this is discarded on load — the caller's rule. */
  readonly ttlMs: number;
  readonly now?: () => number;
}

function isStoredRun(value: unknown): value is StoredRun {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoredRun).invocationId === 'string' &&
    (value as StoredRun).invocationId !== '' &&
    typeof (value as StoredRun).startedAt === 'number'
  );
}

/**
 * The persisted run state of one provider-backed run, with its TTL: what
 * lets a generation survive a page reload and stop resuming after the
 * provider has long forgotten the invocation. Stored through the
 * namespaced storage wrapper (§5.4), so a logout sweeps it.
 */
export function createRunStorage({ key, ttlMs, now = Date.now }: RunStorageOptions): RunStorage {
  const store = createStorage('local');
  return {
    load: () => {
      const stored = store.getJSON<StoredRun>(key, (raw) => (isStoredRun(raw) ? raw : (undefined as never)));
      if (stored === null) return null;
      if (now() - stored.startedAt >= ttlMs) {
        store.remove(key);
        return null;
      }
      return stored;
    },
    save: (run) => {
      store.setJSON(key, run);
    },
    clear: () => {
      store.remove(key);
    },
  };
}
