/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20
 * exported symbols, enforced by `scripts/check-budgets.mjs`).
 *
 * This slice's first landing (sub-unit A2b: fstring-autocomplete +
 * yaml-editor — two small, mostly-standalone widgets with no
 * `pipelines`-internal dependencies of their own). Deliberately using only
 * 8 of the 20 slots: several more `pipelines` sub-units land in this same
 * batch (the flow editor, the create/edit forms), all sharing this one
 * budget.
 *
 * `useFStringAutocomplete` (the lower-level state-machine hook) is exported
 * alongside `useFStringInputAutocomplete` (the DOM-wiring hook that
 * composes it) even though `A2a`/`A2i` (this domain's other sub-units, the
 * declared consumers of this pair) most likely only need the latter — kept
 * public because it is independently useful to any future input surface
 * that wants its own DOM wiring (e.g. a non-`<input>`/`<textarea>` editor)
 * without duplicating the open/query/keyboard-nav state machine. Both
 * remain available via ordinary intra-slice import either way (R-L3: intra-
 * slice imports are unrestricted), so nothing is blocked if this call turns
 * out wrong later.
 */
export { FStringAutocompletePopper } from './ui/FStringAutocompletePopper';
export type { FStringAutocompletePopperProps } from './ui/FStringAutocompletePopper';

export { useFStringAutocomplete } from './model/useFStringAutocomplete';
export { useFStringInputAutocomplete } from './model/useFStringInputAutocomplete';

export type { FStringAutocompleteOption, FStringAutocompleteState } from './lib/fStringAutocomplete';

export { YamlCodeEditor } from './ui/YamlCodeEditor';
export type { YamlCodeEditorProps } from './ui/YamlCodeEditor';

/**
 * Sub-unit A2l's ("PipelineEditor.jsx composition + chat-integration hooks
 * + pipeline slices") contribution — `PipelineEditor`/`useEditPipeline`/
 * `usePipelineCreation` per this batch's own explicit cross-domain
 * requirement ("Wave-2 unit C6 needs all three importable cross-feature —
 * their only real consumer today is `pages/NewChat/NewChat.jsx`").
 *
 * Only the component/hooks and `PipelineEditorProps`/`PipelineEditorHandle`
 * are spent here. `PipelineEditorDeps` (and its constituent slot-prop
 * types: `PipelineConfigurationPanels`, `PipelineCreateFormSlotProps`,
 * `PipelineLlmModelSelectorSlotProps`, `PipelineConfigurationPanelSlotProps`,
 * `PipelineEditorShellProps`) and `useEditPipeline`'s/
 * `usePipelineCreation`'s own params/result types stay off this curated
 * list, same call `features/agents/index.ts` already made for
 * `AgentEditor`'s identically-shaped `AgentEditorDeps`/
 * `AgentEditorShellProps`/`AgentConfigurationFormSlotProps` ("a caller
 * assembling the `deps` object types it structurally against
 * `AgentEditor`'s own prop type without needing a separate import") — every
 * one of them is a plain object literal a caller builds inline, checked
 * structurally against `PipelineEditorProps['deps']`/the hooks' own
 * parameter types with no explicit import required. `PipelineEditorHandle`
 * IS exported because it is used as an explicit type-parameter
 * (`useRef<PipelineEditorHandle>`/`createRef<PipelineEditorHandle>`), not a
 * structurally-checked object literal — `AgentEditor` has no ref/imperative
 * handle at all, so there is no equivalent precedent to follow either way.
 */
export { PipelineEditor } from './ui/PipelineEditor';
export type { PipelineEditorProps, PipelineEditorHandle } from './ui/PipelineEditor';

export { useEditPipeline } from './model/useEditPipeline';
export { usePipelineCreation } from './model/usePipelineCreation';
