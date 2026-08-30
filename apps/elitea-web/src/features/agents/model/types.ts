/**
 * `features/agents` domain value shapes — a plain-object mirror of the
 * baseline's Formik `values` shape for the agent create/edit form
 * (`apps/elitea-ui/src/[fsd]/features/agent/ui/agent-details/configurations/
 * form/CreateAgentForm.jsx`, `formik.values.{name,description,
 * version_details.*}`).
 *
 * **DISCLOSED REDESIGN — no ambient form-library context.** The baseline
 * pulled every one of these fields from `useFormikContext()`. This app has
 * no Formik dependency (react-hook-form + zod instead — see
 * `package.json`), and the established convention for this exact situation
 * (`features/mcps/ui/McpAuthStatusBadge.tsx`'s own doc comment: "`values`
 * is a required prop instead of pulled from `useFormikContext()`... this
 * app uses react-hook-form, not formik, and `shared/ui`/`features/`
 * components should not assume a specific form-library context is mounted
 * above them") is followed here for every component in this slice: each
 * takes its relevant slice of `values` plus an `onFieldChange` callback as
 * plain props. `onFieldChange(path, value)` mirrors Formik's own
 * `setFieldValue(path, value)` signature exactly (dot-path string + new
 * value) — the ONE deliberately-generic escape hatch, kept for the same
 * reason the baseline used it: `CreateAgentForm`/`ApplicationTools` touch
 * a couple dozen distinct nested fields, and one typed callback per field
 * would blow the §3.5 12-prop budget many times over (`BasicAccordion`'s
 * and `InputBase`'s own doc comments already establish "group into one
 * option object" as this codebase's answer to that budget; a single
 * generic setter is the same move applied to a write-path instead of a
 * read-path options bag). The caller (a page-level composition, outside
 * this slice) owns the actual form-state mechanism (react-hook-form,
 * `useState`, anything) and supplies `values`/`onFieldChange` however it
 * likes.
 */
import type { AgentLlmSettings } from '@/shared/api/agentLlmSettings';

/** One `version_details.variables[]` entry — `apps/elitea-ui/src/components/VariableList.jsx:7-24`. */
export interface AgentVariable {
  readonly id?: string | number | undefined;
  readonly name: string;
  readonly value: string;
}

/**
 * `version_details.meta` — settings bag. Indexable (`Record<string, unknown>`)
 * because `AgentMetaSwitch` (`configurations/switch/AgentMetaSwitch.jsx`)
 * reads/writes an arbitrary caller-supplied key here, same as the baseline.
 */
interface AgentVersionMeta {
  readonly step_limit?: number | undefined;
  readonly internal_tools?: readonly string[] | undefined;
  readonly ignore_project_context?: boolean | undefined;
  readonly icon_meta?: unknown;
  readonly attachment_toolkit_id?: string | undefined;
  readonly [metaKey: string]: unknown;
}

/**
 * One `version_details.tools[]` entry — a toolkit/MCP/application reference
 * attached to this agent version. `apps/elitea-ui/src/pages/Applications/
 * Components/Tools/ToolCard.jsx`'s own destructure (`type`, `name`,
 * `settings`) is the fullest evidence available inside this unit's owned
 * files; `settings` is left opaque (`Record<string, unknown>`) since its
 * shape is toolkit-type-specific.
 */
interface AgentToolRef {
  readonly type: string;
  readonly name?: string | undefined;
  readonly settings?: Readonly<Record<string, unknown>> | undefined;
}

/** `version_details` — the mutable half of an agent version. */
interface AgentVersionDetails {
  readonly id?: number | undefined;
  readonly name?: string | undefined;
  readonly instructions?: string | undefined;
  readonly welcome_message?: string | undefined;
  readonly notes?: string | undefined;
  /** #307 — the agent's chat starters. Present in the baseline's Formik `values` all along (`ConversationStarters.jsx` reads `version_details.conversation_starters`); it was missing here only because no editor had been ported. */
  readonly conversation_starters?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly variables?: readonly AgentVariable[] | undefined;
  readonly tools?: readonly AgentToolRef[] | undefined;
  readonly meta?: AgentVersionMeta | undefined;
  /**
   * The model this version runs on. Typed as the shared `AgentLlmSettings`
   * rather than an opaque record so the form cannot author a key the worker
   * refuses — see `shared/api/agentLlmSettings.ts` for the closed key list.
   */
  readonly llm_settings?: AgentLlmSettings | undefined;
}

/** The full `CreateAgentForm`-level draft — `formik.values` at the top level. */
export interface AgentDraftValues {
  readonly id?: number | undefined;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly version_details?: AgentVersionDetails | undefined;
}

/** Generic nested-path setter — see the module doc comment for why this is one function, not N typed callbacks. */
export type AgentFieldChange = (path: string, value: unknown) => void;
