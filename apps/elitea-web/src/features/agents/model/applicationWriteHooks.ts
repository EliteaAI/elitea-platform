/**
 * Bundled application/version WRITE hooks — exported as a single object so
 * the five of them cost 1 slot in the §3.5 barrel budget (20) instead of 5,
 * following the `agentEditorHooks`/`applicationValidationHooks` precedent in
 * this same directory.
 *
 * #345 — the repack is what paid for `AgentTagEditor` reaching
 * `pages/agents/EditApplication.tsx`. The barrel was at exactly 20/20 and
 * the tag control, though fully built, had no slot left to spend on it — the
 * same shape #307 already hit with the delete/export buttons. Only
 * `useSaveVersion` had a consumer outside this slice
 * (`pages/agents/lib/useEditApplicationForm.ts`, updated with this change);
 * the other four had none (verified by grep for `from '@/features/agents'`
 * across `src/` and `e2e/`). Sibling files inside this slice import them from
 * their own modules directly under R-L3 and are unaffected either way.
 *
 * The repack deliberately leaves headroom rather than spending it: three
 * slots stay free for the agent-editor work still landing.
 */
import { useCreateApplication } from './useCreateApplication';
import { useDeleteVersion } from './useDeleteVersion';
import { useSaveChangedTools } from './useSaveChangedTools';
import { useSaveNewVersion } from './useSaveNewVersion';
import { useSaveVersion } from './useSaveVersion';

export const applicationWriteHooks = {
  useCreateApplication,
  useSaveVersion,
  useSaveNewVersion,
  useDeleteVersion,
  useSaveChangedTools,
};
