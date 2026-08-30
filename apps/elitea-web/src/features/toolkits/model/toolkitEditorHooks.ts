/**
 * Bundled hooks for C6's deps-composition root — exported as a single
 * `toolkitEditorHooks` object to consume exactly 1 slot in the §3.5 barrel
 * budget.
 */
import { useEditToolkit } from './useEditToolkit';
import { useToolkitCreation } from './useToolkitCreation';
import { useToolkitSaveValidation } from './useToolkitSaveValidation';

/**
 * Bundle: hooks that C6's composition root needs cross-feature.
 *
 * `useToolkitSaveValidation` rides in this bundle rather than taking a barrel
 * slot of its own: this slice's `index.ts` sits at its 20/20 §3.5 ceiling, and
 * folding a symbol into an existing `as const` object is the convention that
 * file's own budget note already established. `pages/toolkits/CreateToolkit.tsx`
 * is the cross-layer caller that needs it; the two intra-slice callers
 * (`ui/ConfigurationTab.tsx`, `ui/ToolkitEditor.tsx`) import the module directly.
 */
export const toolkitEditorHooks = {
  useEditToolkit,
  useToolkitCreation,
  useToolkitSaveValidation,
};
