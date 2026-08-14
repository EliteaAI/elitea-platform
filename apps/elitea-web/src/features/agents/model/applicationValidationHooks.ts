/**
 * Bundled version/tool validation hooks — exported as a single object so the
 * four of them cost 1 slot in the §3.5 barrel budget (20) instead of 4,
 * following the `agentEditorHooks` precedent in this same directory.
 *
 * #307 — the repack is what paid for `DeleteApplicationButton`/
 * `ExportApplicationButton` reaching `pages/agents/EditApplication.tsx`: the
 * barrel was at exactly 20/20, and both components were fully built with
 * zero importers because there was no slot left to spend on them. Nothing
 * outside `features/agents` imported any of these four (verified by grep for
 * `from '@/features/agents'` across `src/`), so the repack has no call sites
 * to update; sibling files inside this slice import them from the module
 * directly under R-L3 and are unaffected either way.
 */
import {
  useManualValidateApplicationVersion,
  useToolValidationInfo,
  useToolsValidationInfo,
  useValidateApplicationVersion,
} from './useValidateApplicationVersion';

export const applicationValidationHooks = {
  useValidateApplicationVersion,
  useManualValidateApplicationVersion,
  useToolsValidationInfo,
  useToolValidationInfo,
};
