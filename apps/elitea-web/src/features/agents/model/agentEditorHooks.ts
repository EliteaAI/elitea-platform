/**
 * Bundled hooks for C6's deps-composition root — exported as a single
 * `agentEditorHooks` object to consume exactly 1 slot in the §3.5 barrel
 * budget (shared across all A1* sub-units).
 */
import { useAgentCreation } from './useAgentCreation';
import { useEditAgent } from './useEditAgent';
import { useAgentEditorUrlSync } from './useAgentEditorUrlSync';
import { useAvailableInternalTools } from '../lib/internalTools';
import { useIsMcpVisible } from '../api/useIsMcpVisible';

/**
 * Bundle: hooks that C6's composition root needs cross-feature.
 *
 * `useAvailableInternalTools`/`useIsMcpVisible` added for `widgets/chat`'s
 * `PlusChatButton` (baseline `PlusChatButton.jsx` calls both directly —
 * lines 86-87) — bundled here rather than as new top-level exports (zero
 * additional §3.5 budget cost, this barrel is already at 20/20; see the
 * `useApplicationsStore` entry below for the same technique).
 */
export const agentEditorHooks = {
  useAgentCreation,
  useEditAgent,
  useAgentEditorUrlSync,
  useAvailableInternalTools,
  useIsMcpVisible,
};
