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
import { createRunStorage, type RunStorage } from '@/entities/provider-run';

/** The legacy TTL, unchanged: `4 * 60 * 60 * 1000`. */
export const GENERATION_STATE_TTL_MS = 4 * 60 * 60 * 1000;

function keyFor(projectId: string | number, toolkitId: string | number): string {
  return `deepwiki.generation.${String(projectId)}.${String(toolkitId)}`;
}

export type GenerationStorage = RunStorage;

export function createGenerationStorage(
  projectId: string | number,
  toolkitId: string | number,
  now: () => number = Date.now,
): GenerationStorage {
  // The TTL and the key are DeepWiki's; the load/save/clear with the TTL
  // applied on load is the run entity's (ADR-0023 d4).
  return createRunStorage({ key: keyFor(projectId, toolkitId), ttlMs: GENERATION_STATE_TTL_MS, now });
}
