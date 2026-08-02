/**
 * Bundled hooks for C6's deps-composition root — exported as a single
 * `agentEditorHooks` object to consume exactly 1 slot in the §3.5 barrel
 * budget (shared across all A1* sub-units).
 */
import { useAgentCreation } from './useAgentCreation';
import { useEditAgent } from './useEditAgent';
import { useAgentEditorUrlSync } from './useAgentEditorUrlSync';

/**
 * Bundle: hooks that C6's composition root needs cross-feature.
 */
export const agentEditorHooks = {
  useAgentCreation,
  useEditAgent,
  useAgentEditorUrlSync,
};
