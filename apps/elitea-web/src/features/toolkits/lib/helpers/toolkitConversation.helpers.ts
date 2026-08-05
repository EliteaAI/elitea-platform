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
 *  - `DEFAULT_MAX_TOKENS`/`DEFAULT_TEMPERATURE`
 *    (`[fsd]/shared/lib/constants/llmSettings.constants.js:7-8`, values
 *    `-1`/`0.6`) — this two-constant file has NOT been ported to this app's
 *    `shared/lib/**` yet (grepped, zero hits); real, disclosed gap, kept as
 *    local literals with their exact baseline values rather than invented
 *    or rounded.
 */
import { ChatParticipantType } from '@/shared/lib/chat';

/** `[fsd]/shared/lib/constants/llmSettings.constants.js:7-8` — not yet ported to `shared/lib/**`; kept local until it is. */
const DEFAULT_MAX_TOKENS = -1;
const DEFAULT_TEMPERATURE = 0.6;

export interface DefaultLlmSettings {
  readonly temperature: number;
  readonly max_tokens: number;
  readonly top_k: number;
  /** LLM settings are a JS object in the baseline — callers (e.g. `useToolkitChat.hooks.ts`'s `onSetLLMSettings`) may merge in extra provider-specific keys beyond these three. */
  readonly [key: string]: unknown;
}

export const DEFAULT_LLM_SETTINGS: DefaultLlmSettings = {
  temperature: DEFAULT_TEMPERATURE,
  max_tokens: DEFAULT_MAX_TOKENS,
  top_k: 40,
};

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
