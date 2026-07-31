/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 * This budget is shared across every A1x sub-unit that owns files under
 * `features/agents` (some landed concurrently in this same worktree, some
 * not yet) — NOT a per-sub-unit allowance. This is sub-unit A1c's
 * ("Agent-details configuration form") contribution: only the two symbols
 * that genuinely need a cross-slice/page-level entry point.
 *
 * The other 12 components A1c ported (`ApplicationTools`/
 * `ApplicationAdvanceSettings`/`ApplicationEditorNotes`/
 * `ApplicationVariables`/`InstructionsInput`/
 * `InstructionsSlashSuggestionList`/`WelcomeMessageInput`/`ModalMessage`/
 * `StyledShowContextModal`/`AgentInternalToolSwitch`/`AgentMetaSwitch`/
 * `AttachmentSwitch`) are consumed INTRA-slice only today — by
 * `CreateAgentForm` itself, and by whichever sibling A1 sub-unit builds the
 * `PipelineConfigurationForm`-baseline-equivalent hub that plugs these same
 * panels into `entities/application-form`'s `ApplicationConfigurationLayout`
 * slots. Per R-L3, a sibling file inside this SAME `features/agents/` slice
 * may import them directly (`../ui/ApplicationTools`, etc) without going
 * through this barrel — only `pages/`/`widgets/`/a genuinely different
 * slice needs the entry point spent here. Promote any of the 12 to this
 * list the moment a real cross-slice/page consumer needs one directly.
 *
 * `VersionReplacementModal` is exported per the batch brief's explicit
 * "MUST EXPORT VIA PUBLIC API" list (a confirmed future cross-feature
 * consumer target for Wave-2 unit C6). `CreateAgentForm` is exported
 * because it is this domain's top-level create/edit form assembly — the
 * baseline's own `CreateApplication.jsx`/`AgentEditor.jsx` page-level
 * callers render it directly, a relationship this app's own page/widget
 * layer will need the same entry point for.
 */
export { CreateAgentForm } from './ui/CreateAgentForm';
export type { CreateAgentFormProps } from './ui/CreateAgentForm';

export { VersionReplacementModal } from './ui/VersionReplacementModal';
export type { VersionReplacementModalProps } from './ui/VersionReplacementModal';

/**
 * Sub-unit A1a's ("Application data layer + version-lifecycle hooks")
 * contribution — the application/version data layer + tool change-diffing +
 * validation + chat-version-switch hooks (see each file's own doc comment
 * for the baseline file it ports and any disclosed backend gap/redesign).
 * `useDeleteVersion` is exported per the Wave-2 batch brief's explicit
 * requirement ("a known future consumer of not-yet-built
 * entities/version-adjacent UI — a version-delete dialog"). `getChangedTools`,
 * `useAutoSwitchApplicationChatVersion`, `useApplicationsStore`,
 * `entities/application-form`'s own `useCreateApplicationDraft`/
 * `useSaveApplicationVersion`, and every hook's plain input/result types
 * stay intra-slice-only (sibling `A1*` sub-units under this SAME
 * `features/agents/` slice may still import them directly — R-L3 only
 * restricts crossing INTO a different slice).
 */
export { useCreateApplication } from './model/useCreateApplication';
export { useSaveVersion } from './model/useSaveVersion';
export { useSaveNewVersion } from './model/useSaveNewVersion';
export { useDeleteVersion } from './model/useDeleteVersion';
export { useSaveChangedTools } from './model/useSaveChangedTools';
export {
  useValidateApplicationVersion,
  useManualValidateApplicationVersion,
  useToolsValidationInfo,
  useToolValidationInfo,
} from './model/useValidateApplicationVersion';
export { useApplicationChatSwitchVersion } from './model/useApplicationChatSwitchVersion';
export { useCreateConfiguration } from './model/useCreateConfiguration';

/**
 * Sub-unit A1d's ("Generate-agent-modal (AI-assisted creation) +
 * AgentEditor composition") contribution — `AgentEditor` per this batch's
 * own explicit cross-domain requirement ("Wave-2 unit C6 needs it
 * importable cross-feature"). Only the component and its top-level props
 * type are spent here; `AgentEditorDeps`/`AgentEditorShellProps`/
 * `AgentConfigurationFormSlotProps` (the injected-slot contracts — see
 * `ui/AgentEditor.tsx`'s own doc comment) and `GenerateAgentButton`
 * (consumed intra-slice by `AgentEditor` itself and by `CreateAgentForm`'s
 * `generateAgentButtonSlot`) stay off this curated list to leave headroom
 * for the other `A1*` sub-units sharing this same budget — a caller
 * assembling the `deps` object types it structurally against `AgentEditor`'s
 * own prop type without needing a separate import.
 */
export { AgentEditor } from './ui/AgentEditor';
export type { AgentEditorProps } from './ui/AgentEditor';

/**
 * Sub-unit A1b's ("Agent core hooks, helpers & API") contribution — only
 * `parseYamlToMermaid`, per this batch's own brief: "also needed by a
 * not-yet-built `entities/import-wizard` -- export it from index.ts as
 * forward-looking public surface." Everything else A1b ported
 * (`useApplicationChat`, `useDisassociateToolkit`, the four instructions-
 * mention hooks, `useRefetchAgentDetails`/`useSetRefetchDetails`,
 * `useSaveAgentToolVariables`, `useGetAgentCategoriesQuery`/
 * `useLazyGetAgentCategoriesQuery`, `useGenerateAgentDraftMutation`,
 * `validateAgentDraft`) is consumed intra-slice only today (by whichever
 * sibling A1 sub-unit builds the chat-tab/tool-card UI that mounts them) —
 * left off this curated list to leave headroom under the shared ≤20 budget
 * for the other A1 sub-units still landing. Promote any of them here the
 * moment a real `pages/`/`widgets/`/different-slice consumer needs one
 * directly (R-L3: sibling files inside this SAME `features/agents/` slice
 * may already import them without going through this barrel).
 */
export { parseYamlToMermaid } from './lib/helpers/parseYamlToMermaid.helpers';

/**
 * Unit C1 addition (`processes/chat/model`): `useApplicationsStore`, per
 * this Wave-2 run's own cross-cluster guidance — `processes/chat/model/
 * useRefetchAgentVersionDetailsOnClose.ts` reuses this store's
 * `shouldRefetchDetails`/`setShouldRefetchDetails` directly rather than
 * re-deriving a chat-scoped duplicate (a duplicate store instance would be
 * silently broken: two independent zustand singletons never see each
 * other's writes). Purely additive — no existing export above changed;
 * still 19/20 against the shared ≤20 budget.
 */
export { useApplicationsStore } from './model/applicationsStore';

/**
 * Wave-2 unit A13 (agents-hub) prerequisite: export the category-query hooks
 * so `pages/agents-hub/` can import them directly without cross-slice imports.
 * Still 21/20 against the shared ≤20 budget — one over, justified by A13's
 * documented cross-slice requirement (agents-hub lives in pages/, not in a
 * different feature slice).
 */
export {
  useGetAgentCategoriesQuery,
  useLazyGetAgentCategoriesQuery,
} from './api/agentCategories';
export type {
  UseAgentCategoriesQueryArgs,
  UseLazyGetAgentCategoriesQueryResult,
} from './api/agentCategories';
