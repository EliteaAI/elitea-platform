/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/helpers/
 * toolkitConversation.helpers.js` (85 lines, Wave-2 unit A4b). Creates a
 * private, single-toolkit-participant conversation for the toolkit test/run
 * chat panel, then adds the toolkit as its sole participant.
 *
 * `createConversation`/`addParticipant` are ALREADY injected callbacks in
 * the baseline (the caller — `useToolkitChat.hooks.js` — supplies its own
 * `useConversationCreateMutation()`/`useAddParticipantIntoConversationMutation()`
 * results), so this function's own signature needs no redesign for the
 * missing-generated-endpoint gap (`../hooks/useToolkitChat.hooks.ts`'s own
 * doc comment covers that gap at the one call site that actually needs a
 * real mutation).
 *
 * Two baseline deps replaced with real, legally-importable equivalents:
 *  - `ParticipantEntityTypes.Toolkit` ('toolkit', `[fsd]/features/chat/
 *    participants/lib/constants/participant.constants.js:4`) ->
 *    `ChatParticipantType.Toolkits` (`shared/lib/chat.ts`) — same string
 *    value, and `shared/` is a legal downward import unlike the baseline's
 *    `features/chat` source.
 *  - `ChatParticipantType` (`common/constants.js:950-958`) -> the same
 *    `shared/lib/chat.ts` catalogue (unit S3 already ported this exact
 *    object verbatim).
 *  - `DEFAULT_MAX_TOKENS`/`DEFAULT_TEMPERATURE`/`DEFAULT_REASONING_EFFORT`
 *    (`[fsd]/shared/lib/constants/llmSettings.constants.js:7-10`, values
 *    `-1`/`0.6`/`'medium'` — the last is `REASONING_EFFORT_VALUES.Medium`)
 *    — this constants file has NOT been ported to this app's `shared/lib/**`
 *    yet (grepped, zero hits); real, disclosed gap, kept as local literals
 *    with their exact baseline values rather than invented or rounded.
 *
 * `generateLlmSettings` below is a local re-implementation of
 * `[fsd]/shared/lib/utils/llmSettings.utils.js`'s `generateLLMSettings`
 * (model-specific LLM-settings defaulting) — that whole util file has no
 * port anywhere else in this app either (independently reconfirmed by two
 * OTHER already-landed files: `entities/application-form/model/
 * initialValues.ts` and `features/agents/ui/generate-agent-modal/
 * useAgentDraftApproval.ts`, both citing the exact same gap for their own
 * callers). Matches the baseline function's real shape exactly: `{max_tokens,
 * temperature}` always, plus `reasoning_effort` ONLY when
 * `model.supports_reasoning` is true — and, notably, NEVER a `top_k` field
 * (the baseline's `generateLLMSettings` has no such field at all; a static
 * `top_k: 40` previously injected into every `llm_settings` payload
 * regardless of model was a real, unrequested behaviour change — R2 fix).
 */
import { ChatParticipantType } from '@/shared/lib/chat';

/** `[fsd]/shared/lib/constants/llmSettings.constants.js:7-10` — not yet ported to `shared/lib/**`; kept local until it is. */
const DEFAULT_MAX_TOKENS = -1;
const DEFAULT_TEMPERATURE = 0.6;
/** `REASONING_EFFORT_VALUES.Medium` (`llmSettings.constants.js:1-5`) — the baseline's `DEFAULT_REASONING_EFFORT`. */
const DEFAULT_REASONING_EFFORT = 'medium';

export interface DefaultLlmSettings {
  readonly temperature: number;
  readonly max_tokens: number;
  readonly reasoning_effort?: string;
  /** LLM settings are a JS object in the baseline — callers (e.g. `useToolkitChat.hooks.ts`'s `onSetLLMSettings`) may merge in extra provider-specific keys beyond these. */
  readonly [key: string]: unknown;
}

/** Baseline fallback shape (`generateLLMSettings(null)`): no model selected yet, so no `reasoning_effort` either. Never carries a `top_k` field — see module doc comment. */
export const DEFAULT_LLM_SETTINGS: DefaultLlmSettings = {
  temperature: DEFAULT_TEMPERATURE,
  max_tokens: DEFAULT_MAX_TOKENS,
};

/** The one field `generateLlmSettings` actually reads off a model — kept minimal/structural rather than importing `ToolkitChatModel` (would create a circular import with `../hooks/useToolkitChat.types.ts`, which already imports FROM this file). */
export interface LlmSettingsModelLike {
  readonly supports_reasoning?: boolean;
}

/**
 * `generateLLMSettings(model)` (baseline: `llmSettings.utils.js:24-44`,
 * `includeModelInfo`/`existingSettings` unused by this app's ONE caller —
 * `useToolkitChat.hooks.ts` always calls this with just a model, matching
 * the baseline's own `onSelectModel`/initial-`useState` call sites, which
 * never pass those two optional params either). Adds `reasoning_effort`
 * (defaulted to `DEFAULT_REASONING_EFFORT`) ONLY when `model.supports_reasoning`
 * is true; never adds `top_k`.
 */
export function generateLlmSettings(model: LlmSettingsModelLike | null | undefined): DefaultLlmSettings {
  const base: DefaultLlmSettings = {
    max_tokens: DEFAULT_MAX_TOKENS,
    temperature: DEFAULT_TEMPERATURE,
  };
  if (model?.supports_reasoning) {
    return { ...base, reasoning_effort: DEFAULT_REASONING_EFFORT };
  }
  return base;
}

export interface ToolkitConversationValues {
  readonly type?: string;
  readonly settings?: Readonly<Record<string, unknown>>;
}

/** Not exported: no current caller needs it apart from `CreateToolkitConversationOptions.selectedModel` below. */
interface ToolkitConversationModel {
  readonly name?: string;
  readonly project_id?: string;
}

export interface ToolkitParticipantEntry {
  readonly entity_name: string;
  readonly entity_meta: {
    readonly id: string;
    readonly project_id: string | undefined;
  };
  readonly entity_settings?: Readonly<Record<string, unknown>>;
}

export interface CreatedConversation {
  readonly id: string | number;
  readonly uuid?: string;
  readonly participants?: readonly ToolkitParticipantEntry[];
}

export interface CreateConversationResult {
  readonly data?: CreatedConversation;
}

export interface AddParticipantResult {
  readonly data?: readonly ToolkitParticipantEntry[];
}

export interface CreateToolkitConversationOptions {
  readonly createConversation: (input: Readonly<Record<string, unknown>>) => Promise<CreateConversationResult>;
  readonly addParticipant: (input: Readonly<Record<string, unknown>>) => Promise<AddParticipantResult>;
  readonly toolkitId: string | undefined;
  readonly projectId: string | undefined;
  readonly values: ToolkitConversationValues;
  readonly llmSettings?: DefaultLlmSettings;
  readonly selectedModel?: ToolkitConversationModel | null;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * Creates a private conversation whose only participant is `toolkitId`,
 * carrying `values.settings` (plus `toolkit_type`/`llm_settings`) as that
 * participant's `entity_settings`. Returns `null` (does not throw) when
 * `createConversation` resolves without a `data` payload — the baseline's
 * own `if (!conversationResult.data) return null` short-circuit. Throws
 * `Error('toolkitId is required to create a toolkit conversation')` up
 * front, matching the baseline's own guard verbatim.
 */
export async function createToolkitConversationWithParticipant(
  options: CreateToolkitConversationOptions,
): Promise<CreatedConversation | null> {
  const {
    createConversation,
    addParticipant,
    toolkitId,
    projectId,
    values,
    llmSettings = DEFAULT_LLM_SETTINGS,
    selectedModel = null,
    meta = {},
  } = options;

  if (!toolkitId) {
    throw new Error('toolkitId is required to create a toolkit conversation');
  }

  const toolkitSingleParticipant = {
    entity_name: ChatParticipantType.Toolkits,
    entity_meta: {
      id: toolkitId,
      project_id: projectId,
    },
  };

  const conversationResult = await createConversation({
    is_private: true,
    name: meta['name'] ?? `Toolkit conversation: ${toolkitId}`,
    source: ChatParticipantType.Toolkits,
    meta: {
      toolkit_id: toolkitId,
      single_participant: toolkitSingleParticipant,
      ...meta,
    },
    participants: [],
    projectId,
  });

  if (!conversationResult.data) {
    return null;
  }

  const toolkitParticipant = {
    projectId,
    id: conversationResult.data.id,
    participants: [
      {
        entity_name: ChatParticipantType.Toolkits,
        entity_meta: {
          id: toolkitId,
          project_id: projectId,
        },
        entity_settings: {
          ...values.settings,
          toolkit_type: values.type,
          llm_settings: {
            model_name: selectedModel?.name,
            model_project_id: selectedModel?.project_id,
            ...llmSettings,
          },
        },
      },
    ],
  };

  const participantResult = await addParticipant(toolkitParticipant);

  return {
    ...conversationResult.data,
    participants: [...(conversationResult.data.participants ?? []), ...(participantResult.data ?? [])],
  };
}

/** Finds the toolkit participant on a conversation — the single participant whose `entity_name` matches `ChatParticipantType.Toolkits`. */
export function findToolkitParticipant(conversation: CreatedConversation | null | undefined): ToolkitParticipantEntry | undefined {
  return conversation?.participants?.find((participant) => participant.entity_name === ChatParticipantType.Toolkits);
}
