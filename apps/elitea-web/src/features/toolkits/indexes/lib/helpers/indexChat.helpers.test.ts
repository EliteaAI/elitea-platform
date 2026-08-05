import { describe, expect, it, vi } from 'vitest';

import { IndexesToolsEnum } from '../constants/indexDetails.constants';

import {
  adjustIndexDataSchema,
  generateIndexDataPayload,
  generateMockMessageTemplate,
  generateWelcomeMessage,
  getMockToolkitIndexConversation,
  type IndexChatMessage,
} from './indexChat.helpers';

// `generateChatMessageBasedOnResponse` moved to the sibling
// `indexChatReducer.local.ts` (to avoid a circular module dependency — see
// `indexChat.helpers.ts`'s own doc comment) and its tests moved with it,
// to `indexChatReducer.local.test.ts`.

describe('getMockToolkitIndexConversation', () => {
  it('builds a two-participant mock conversation wrapping the given history', () => {
    const history: IndexChatMessage[] = [
      { id: '1', role: 'assistant', content: 'hi', created_at: 1, participant_id: 'system' },
    ];
    const conversation = getMockToolkitIndexConversation(history);
    expect(conversation.id).toBe('toolkit-test');
    expect(conversation.participants).toHaveLength(2);
    expect(conversation.participants[1]?.entity_name).toBe('application');
    expect(conversation.chat_history).toBe(history);
  });
});

describe('generateWelcomeMessage', () => {
  it('defaults to the index_data configure-and-index copy', () => {
    const message = generateWelcomeMessage();
    expect(message.content).toBe('Configure index parameters and start indexing or reindexing');
    expect(message.role).toBe('assistant');
  });

  it('returns test-tools copy when isTestTools is set, regardless of tool', () => {
    const message = generateWelcomeMessage(IndexesToolsEnum.searchIndexData, true);
    expect(message.content).toContain("Select a tool from the Test Settings panel");
  });

  it('returns per-tool copy for search/stepback tools', () => {
    expect(generateWelcomeMessage(IndexesToolsEnum.searchIndexData).content).toContain('searching the index');
    expect(generateWelcomeMessage(IndexesToolsEnum.stepbackSearchIndex).content).toContain('stepback search');
    expect(generateWelcomeMessage(IndexesToolsEnum.stepbackSummaryIndex).content).toContain('stepback summary');
  });
});

describe('generateIndexDataPayload', () => {
  it('assembles the toolkit_config/tool_params/llm_settings payload shape', () => {
    const payload = generateIndexDataPayload({
      projectId: 'proj-1',
      values: { type: 'github', id: 'toolkit-1', settings: { url: 'https://x' } },
      toolInputVariables: { index_name: 'my-index' },
      selectedModel: { name: 'gpt-4o', project_id: 'proj-1' },
      llmSettings: { temperature: 0.2 },
      tool: 'index_data',
    });

    expect(payload).toEqual({
      project_id: 'proj-1',
      toolkit_config: {
        type: 'github',
        toolkit_name: 'github',
        toolkit_id: 'toolkit-1',
        settings: { url: 'https://x' },
      },
      tool_name: 'index_data',
      tool_params: { index_name: 'my-index' },
      llm_model: 'gpt-4o',
      llm_settings: { temperature: 0.2, model_name: 'gpt-4o', model_project_id: 'proj-1' },
    });
  });

  it('falls back to gpt-4o-mini and empty tool_params when unset', () => {
    const payload = generateIndexDataPayload({
      projectId: undefined,
      values: {},
      toolInputVariables: 'not-an-object',
      selectedModel: undefined,
      llmSettings: undefined,
      tool: 'search_index',
    });
    expect(payload['llm_model']).toBe('gpt-4o-mini');
    expect(payload['tool_params']).toEqual({});
  });
});

describe('generateMockMessageTemplate', () => {
  it('builds an assistant message with a generated id', () => {
    const message = generateMockMessageTemplate('hello', 'toolkit');
    expect(message.role).toBe('assistant');
    expect(message.content).toBe('hello');
    expect(message.participant_id).toBe('toolkit');
    expect(message.id).toBeTruthy();
  });
});

describe('adjustIndexDataSchema', () => {
  it('returns the schema unchanged when it has no properties', () => {
    expect(adjustIndexDataSchema(undefined)).toBeUndefined();
    expect(adjustIndexDataSchema({})).toEqual({});
  });

  it('logs a console.warn diagnostic on the invalid-schema early-return branch', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    adjustIndexDataSchema({});
    expect(warnSpy).toHaveBeenCalledWith('Invalid schema object provided:', {});
    warnSpy.mockRestore();
  });

  it('deep-merges adjustments only onto properties that already exist', () => {
    const schema = { properties: { index_name: { type: 'string' }, query: { type: 'string' } } };
    const adjusted = adjustIndexDataSchema(schema, {
      index_name: { error: 'taken' },
      not_present: { hidden: true },
    });
    expect(adjusted?.properties?.['index_name']).toEqual({ type: 'string', error: 'taken' });
    expect(adjusted?.properties?.['not_present']).toBeUndefined();
    // Original schema is not mutated.
    expect(schema.properties['index_name']).toEqual({ type: 'string' });
  });
});
