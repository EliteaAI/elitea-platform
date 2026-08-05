/**
 * Port of `apps/elitea-ui/src/[fsd]/features/toolkits/indexes/lib/helpers/
 * indexChat.helpers.js` (unit A4a). Pure helpers driving the index
 * test-chat panel: a mock conversation shape for the local-only "index"
 * chat participant, welcome-message copy per tool, the `index_data`
 * request payload, and the index-data JSON-Schema adjustment helper
 * `IndexDetails` uses to inject dynamic per-view defaults/overrides. The
 * socket-message -> chat-history reducer itself
 * (`generateChatMessageBasedOnResponse`, still re-exported from here — see
 * bottom of file) now lives in the sibling `indexChatReducer.local.ts`,
 * split out purely to keep this file under the repo's 400-line budget; its
 * own doc comment carries the `SocketMessageType`/`ToolActionStatus`/
 * `convertJsonToString` provenance notes that used to live here.
 *
 * `ROLES`/`WELCOME_MESSAGE_ID` come from `shared/lib/enums.ts` (unit S3);
 * `ChatParticipantType` comes from `shared/lib/chat.ts` (unit S3) — both
 * real, already-promoted `shared/` surface, not local duplicates.
 *
 * `generateMockMessageTemplate`'s id uses `crypto.randomUUID()` rather than
 * the baseline's `uuid` package's `v4()` — this app has no `@types/uuid`
 * (`uuid`'s own `package.json` `exports` map has no `types` condition for
 * this project's `moduleResolution`; confirmed the same "Could not find a
 * declaration file for module 'uuid'" error already exists, pre-this-unit,
 * against `features/toolkits/lib/hooks/useToolkitChat.hooks.ts`'s own
 * `import { v4 as uuidv4 } from 'uuid'` — not something introduced here).
 * That same sibling file already uses `crypto.randomUUID()` (a native,
 * fully-typed Web API) for its OTHER id generation, confirming it as this
 * codebase's preferred alternative — used here throughout instead, so this
 * file carries no `uuid` import (and no undeclared-module error) at all.
 */
import { ChatParticipantType } from '@/shared/lib/chat';
import { ROLES, WELCOME_MESSAGE_ID } from '@/shared/lib/enums';

import { IndexesToolsEnum } from '../constants/indexDetails.constants';

/**
 * `IndexChatMessage` now lives in the sibling `indexChatMessage.types.ts`
 * (re-exported here so every existing consumer of this module keeps
 * importing it from this same path) — split out to break a circular
 * module dependency with `indexChatReducer.local.ts`; see that file's own
 * doc comment for the full rationale. `IndexToolAction` (the OTHER type
 * that used to live here) is NOT re-exported: it was never imported by
 * name anywhere, only reached structurally through
 * `IndexChatMessage.toolActions` — `indexChatMessage.types.ts` now keeps
 * it module-private for the same reason (see its own comment).
 */
export type { IndexChatMessage } from './indexChatMessage.types';
import type { IndexChatMessage } from './indexChatMessage.types';

interface MockToolkitIndexConversation {
  id: string;
  uuid: string;
  participants: ReadonlyArray<{
    id: string;
    entity_name: string;
    entity_meta: Record<string, unknown>;
    meta: Record<string, unknown>;
  }>;
  chat_history: readonly IndexChatMessage[];
}

export function getMockToolkitIndexConversation(chatHistory: readonly IndexChatMessage[]): MockToolkitIndexConversation {
  return {
    id: 'toolkit-test',
    uuid: 'toolkit-test-uuid',
    participants: [
      {
        id: 'user',
        entity_name: ChatParticipantType.Users,
        entity_meta: {},
        meta: {
          user_name: 'User',
        },
      },
      {
        id: 'toolkit',
        // Use Applications type since it handles meta.name.
        entity_name: ChatParticipantType.Applications,
        entity_meta: {},
        meta: {
          name: 'Toolkit',
        },
      },
    ],
    chat_history: chatHistory,
  };
}

export function generateWelcomeMessage(
  tool: string = IndexesToolsEnum.indexData,
  isTestTools = false,
): IndexChatMessage {
  let content = 'Configure index parameters and start indexing or reindexing';

  if (isTestTools) {
    content = "Welcome! Select a tool from the Test Settings panel and click 'RUN TOOL' to see the results here.";
  } else {
    switch (tool) {
      case IndexesToolsEnum.searchIndexData:
        content = 'Welcome! Configure search parameters and start searching the index';
        break;
      case IndexesToolsEnum.stepbackSearchIndex:
        content = 'Welcome! Configure stepback search parameters and start searching the index';
        break;
      case IndexesToolsEnum.stepbackSummaryIndex:
        content = 'Welcome! Configure stepback summary parameters and start summarizing the index';
        break;
      default:
        break;
    }
  }

  return {
    id: WELCOME_MESSAGE_ID,
    role: ROLES.Assistant,
    content,
    created_at: new Date().getTime(),
    participant_id: 'system',
  };
}

interface SelectedModelLike {
  name?: string;
  project_id?: string | number;
}

export interface GenerateIndexDataPayloadParams {
  projectId: string | number | undefined;
  values: {
    type?: string;
    toolkit_name?: string;
    id?: string | number;
    settings?: Record<string, unknown>;
  };
  toolInputVariables: unknown;
  selectedModel: SelectedModelLike | undefined;
  llmSettings: Record<string, unknown> | undefined;
  tool: string;
}

export function generateIndexDataPayload(params: GenerateIndexDataPayloadParams): Record<string, unknown> {
  const { projectId, values, toolInputVariables, selectedModel, llmSettings, tool } = params;
  return {
    project_id: projectId,
    toolkit_config: {
      // The toolkit type (e.g. "github").
      type: values.type,
      // Use the actual toolkit_name from form data.
      toolkit_name: values.toolkit_name || values.type,
      // Add toolkit_id inside toolkit_config.
      toolkit_id: values.id,
      // Use the toolkit settings from form.
      settings: values.settings || {},
    },
    tool_name: tool,
    tool_params:
      toolInputVariables && typeof toolInputVariables === 'object' && !Array.isArray(toolInputVariables)
        ? toolInputVariables
        : {},
    // Use selected model.
    llm_model: selectedModel?.name || 'gpt-4o-mini',
    llm_settings: {
      ...llmSettings,
      model_name: selectedModel?.name || 'gpt-4o-mini',
      model_project_id: selectedModel?.project_id,
    },
  };
}

export function generateMockMessageTemplate(content: string, participantId: string): IndexChatMessage {
  return {
    id: crypto.randomUUID(),
    // Use Assistant role so it renders with AIAnswer (supports markdown).
    role: ROLES.Assistant,
    content,
    created_at: new Date().getTime(),
    participant_id: participantId,
  };
}

/**
 * The socket-message -> chat-history reducer (`generateChatMessageBasedOnResponse`)
 * and its supporting types/branch functions live in the sibling
 * `indexChatReducer.local.ts` — split out purely to keep this file under
 * the repo's 400-line budget (R-eslint(max-lines)). Re-exported here
 * because `features/toolkits/lib/hooks/useToolkitChat*.hooks.ts` (unit
 * A4b, not owned by this sub-unit) already imports both from this exact
 * path — breaking that import was a real regression this sub-unit is
 * responsible for not introducing, not an A4b bug to leave for them.
 * `indexChatReducer.local.ts` does NOT import anything from this file (see
 * its own doc comment and `indexChatMessage.types.ts`'s), so this
 * single-direction re-export is not a circular dependency.
 */
export { generateChatMessageBasedOnResponse } from './indexChatReducer.local';
export type { GenerateChatMessageBasedOnResponseParams } from './indexChatReducer.local';

interface JsonSchemaProperty {
  [key: string]: unknown;
}

export interface JsonSchemaLike {
  properties?: Record<string, JsonSchemaProperty> | undefined;
  required?: readonly string[] | undefined;
  [key: string]: unknown;
}

function deepMerge(target: unknown, source: Record<string, unknown>): Record<string, unknown> {
  if (typeof target !== 'object' || target === null) return structuredClone(source);

  const output = structuredClone(target) as Record<string, unknown>;

  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = deepMerge(output[key], value as Record<string, unknown>);
    } else {
      output[key] = value;
    }
  }

  return output;
}

/**
 * Applies per-property overrides (e.g. `{error: '...'}`, `{hidden: true}`)
 * onto a JSON-Schema-like object's `properties`, only for properties that
 * already exist in the schema. Port of `indexChat.helpers.js`'s
 * `adjustIndexDataSchema` (325-343).
 */
export function adjustIndexDataSchema(
  schema: JsonSchemaLike | null | undefined,
  adjustments: Record<string, Record<string, unknown>> = {},
): JsonSchemaLike | null | undefined {
  if (!schema || typeof schema !== 'object' || !schema.properties) {
    // eslint-disable-next-line no-console
    console.warn('Invalid schema object provided:', schema);
    return schema;
  }

  const newSchema = structuredClone(schema);

  for (const [propName, updates] of Object.entries(adjustments)) {
    const current = newSchema.properties?.[propName];
    if (current) {
      newSchema.properties![propName] = deepMerge(current, updates);
    }
  }

  return newSchema;
}
