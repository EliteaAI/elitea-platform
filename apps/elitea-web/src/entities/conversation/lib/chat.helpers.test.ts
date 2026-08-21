import { describe, expect, it } from 'vitest';

import {
  buildHitlInterruptFromRaw,
  calculateDuration,
  canDeleteThisAIMessage,
  createHitlEditUserMessage,
  getInitialChatHistory,
  getModelSettings,
  getParticipantById,
  getSelectedConversationModel,
  getToolActionOriginalName,
  getWelcomeMessage,
} from './chat.helpers';

describe('getWelcomeMessage', () => {
  it('builds an assistant welcome message with the fixed welcome id', () => {
    const message = getWelcomeMessage('hi there');
    expect(message).toMatchObject({ id: 'welcome_message_id', role: 'assistant', content: 'hi there', isLoading: false, isStreaming: false });
    expect(message).not.toHaveProperty('participant_id');
  });

  it('includes participant_id only when supplied', () => {
    const message = getWelcomeMessage('hi', 'p1');
    expect(message.participant_id).toBe('p1');
  });
});

describe('getInitialChatHistory', () => {
  it('is empty when there is no welcome message', () => {
    expect(getInitialChatHistory(undefined)).toEqual([]);
    expect(getInitialChatHistory('')).toEqual([]);
  });

  it('wraps a welcome message when one is supplied', () => {
    expect(getInitialChatHistory('hi')).toHaveLength(1);
  });
});

describe('calculateDuration', () => {
  it('formats hours/minutes/seconds', () => {
    expect(calculateDuration('2024-01-01T00:00:00Z', '2024-01-01T01:02:03Z')).toBe('1 h 2 min and 3 sec');
  });

  it('formats minutes/seconds without hours', () => {
    expect(calculateDuration('2024-01-01T00:00:00Z', '2024-01-01T00:02:03Z')).toBe('2 min and 3 sec');
  });

  it('pluralizes seconds only', () => {
    expect(calculateDuration('2024-01-01T00:00:00Z', '2024-01-01T00:00:03Z')).toBe('3 secs');
  });

  it('uses the singular for exactly 1 second', () => {
    expect(calculateDuration('2024-01-01T00:00:00Z', '2024-01-01T00:00:01Z')).toBe('1 sec');
  });

  it('falls back to "less than a second" for a zero/negative delta', () => {
    expect(calculateDuration('2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')).toBe('less than a second');
  });
});

describe('getParticipantById', () => {
  it('finds a participant by id', () => {
    const conversation = { participants: [{ id: 'a' }, { id: 'b' }] };
    expect(getParticipantById(conversation, 'b')).toEqual({ id: 'b' });
  });

  it('falls back to an empty entity_meta/meta shape when not found', () => {
    expect(getParticipantById({ participants: [] }, 'x')).toEqual({ entity_meta: {}, meta: {} });
    expect(getParticipantById(undefined, 'x')).toEqual({ entity_meta: {}, meta: {} });
  });
});

describe('canDeleteThisAIMessage', () => {
  it('is true only when the found question belongs to userId', () => {
    const history = [{ id: 'q1', user_id: 'u1' }];
    expect(canDeleteThisAIMessage(history, { question_id: 'q1' }, 'u1')).toBe(true);
    expect(canDeleteThisAIMessage(history, { question_id: 'q1' }, 'u2')).toBe(false);
    expect(canDeleteThisAIMessage(history, { question_id: 'missing' }, 'u1')).toBe(false);
  });
});

describe('getToolActionOriginalName', () => {
  it('is null for internal toolkit type', () => {
    expect(getToolActionOriginalName({ toolkit_type: 'internal', original_name: 'x' })).toBeNull();
  });

  it('prefers explicit original_name', () => {
    expect(getToolActionOriginalName({ original_name: 'MyAgent' })).toBe('MyAgent');
  });

  it('extracts the name before the first colon in checkpoint_ns', () => {
    expect(getToolActionOriginalName({ checkpoint_ns: 'MyAgent:abc-123' })).toBe('MyAgent');
  });

  it('skips generic node names', () => {
    expect(getToolActionOriginalName({ checkpoint_ns: 'main_agent:abc' })).toBeNull();
    expect(getToolActionOriginalName({ checkpoint_ns: 'agent:abc' })).toBeNull();
  });

  it('is null with no usable metadata', () => {
    expect(getToolActionOriginalName(undefined)).toBeNull();
    expect(getToolActionOriginalName({})).toBeNull();
  });
});

describe('buildHitlInterruptFromRaw', () => {
  it('fills in defaults for every field when raw is empty', () => {
    const result = buildHitlInterruptFromRaw(undefined);
    expect(result.message).toBe('Please review and take action.');
    expect(result.available_actions).toEqual(['approve', 'reject']);
    expect(result.tool_args).toBeNull();
  });

  it('passes real values through untouched', () => {
    const result = buildHitlInterruptFromRaw({ message: 'Approve?', tool_args: { a: 1 } });
    expect(result.message).toBe('Approve?');
    expect(result.tool_args).toEqual({ a: 1 });
  });
});

describe('createHitlEditUserMessage', () => {
  it('builds a user role message with one text_message item', () => {
    const message = createHitlEditUserMessage({ question: 'Edit this', userId: 'u1', participant: { id: 'p1' } });
    expect(message.role).toBe('user');
    expect(message.content).toBe('Edit this');
    expect(message.user_id).toBe('u1');
    expect(message.participant_id).toBe('p1');
    expect(Array.isArray(message.message_items)).toBe(true);
    expect((message.message_items as unknown[])[0]).toMatchObject({ item_type: 'text_message' });
  });

  it('falls back sentTo to an empty object when no participant is given', () => {
    const message = createHitlEditUserMessage({ question: 'q' });
    expect(message.sentTo).toEqual({});
  });
});

describe('getSelectedConversationModel', () => {
  const conversation = {
    participants: [{ entity_name: 'user', entity_meta: { id: 'u1' }, entity_settings: { llm_settings: { model_name: 'gpt-4', model_project_id: 'p1' } } }],
  };

  it('finds an exact project_id match first', () => {
    const models = [
      { name: 'gpt-4', project_id: 'p1' },
      { name: 'gpt-4', project_id: 'p2' },
    ];
    expect(getSelectedConversationModel(conversation, models, 'u1')).toEqual({ name: 'gpt-4', project_id: 'p1' });
  });

  it('falls back to a name-only match', () => {
    const models = [{ name: 'gpt-4', project_id: 'other' }];
    expect(getSelectedConversationModel(conversation, models, 'u1')).toEqual({ name: 'gpt-4', project_id: 'other' });
  });

  it('is null when there is no user llm settings or no models', () => {
    expect(getSelectedConversationModel({ participants: [] }, [{ name: 'gpt-4' }], 'u1')).toBeNull();
    expect(getSelectedConversationModel(conversation, [], 'u1')).toBeNull();
  });

  /**
   * DEFECT 1: the user-participant lookup compared a numeric `entity_meta.id`
   * with a string `userId` under `===`. It therefore never matched. The
   * composer silently fell back to the project default model on every reopen.
   *
   * DEFECT 2: a conversation this app creates persists the picked model on the
   * `dummy` participant only (`useChatBoxSend.ts`'s `adhocParticipants`), never
   * on the `user` participant this function reads. So even with defect 1 fixed,
   * a conversation created here reopened on the default model.
   */
  it('matches a user participant whose id is a number', () => {
    const numericIdConversation = {
      participants: [{ entity_name: 'user', entity_meta: { id: 5 }, entity_settings: { llm_settings: { model_name: 'gpt-4' } } }],
    };
    expect(getSelectedConversationModel(numericIdConversation, [{ name: 'gpt-4' }], '5')).toEqual({ name: 'gpt-4' });
  });

  it('falls back to the dummy participant when the user participant carries no llm settings', () => {
    const dummyOnly = {
      participants: [
        { entity_name: 'user', entity_meta: { id: 5 } },
        { entity_name: 'dummy', entity_meta: { name: 'gpt-4' }, entity_settings: { llm_settings: { model_name: 'gpt-4', stream: true } } },
      ],
    };
    expect(getSelectedConversationModel(dummyOnly, [{ name: 'gpt-4' }], '5')).toEqual({ name: 'gpt-4' });
  });

  it('prefers the user participant over the dummy one', () => {
    const both = {
      participants: [
        { entity_name: 'user', entity_meta: { id: 5 }, entity_settings: { llm_settings: { model_name: 'user-model' } } },
        { entity_name: 'dummy', entity_settings: { llm_settings: { model_name: 'dummy-model' } } },
      ],
    };
    expect(getSelectedConversationModel(both, [{ name: 'user-model' }, { name: 'dummy-model' }], '5')).toEqual({ name: 'user-model' });
  });
});

describe('getModelSettings', () => {
  it('is empty for a non-application participant', () => {
    expect(getModelSettings({ entity_name: 'toolkit' })).toEqual({});
  });

  it('applies default max_tokens/temperature when absent', () => {
    expect(getModelSettings({ entity_name: 'application', entity_settings: {} })).toEqual({
      max_tokens: -1,
      temperature: 0.6,
      model_name: undefined,
      model_project_id: undefined,
    });
  });

  it('includes reasoning_effort only when explicitly set', () => {
    const withEffort = getModelSettings({ entity_name: 'application', entity_settings: { llm_settings: { reasoning_effort: 'high' } } });
    expect(withEffort.reasoning_effort).toBe('high');
    const without = getModelSettings({ entity_name: 'application', entity_settings: { llm_settings: {} } });
    expect(without).not.toHaveProperty('reasoning_effort');
  });
});
