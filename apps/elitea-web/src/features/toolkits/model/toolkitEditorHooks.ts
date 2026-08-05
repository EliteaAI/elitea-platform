/**
 * Bundled hooks for C6's deps-composition root — exported as a single
 * `toolkitEditorHooks` object to consume exactly 1 slot in the §3.5 barrel
 * budget.
 */
import { useEditToolkit } from './useEditToolkit';
import { useToolkitCreation } from './useToolkitCreation';

/**
 * Bundle: hooks that C6's composition root needs cross-feature.
 */
export const toolkitEditorHooks = {
  useEditToolkit,
  useToolkitCreation,
};
