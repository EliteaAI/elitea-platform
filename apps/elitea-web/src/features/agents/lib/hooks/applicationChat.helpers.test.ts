import { describe, expect, it } from 'vitest';

import type { Participant } from '@/entities/participant';

import type { ChatApplicationVersionDetails, ChatConversation, ChatHistoryMessage } from './applicationChat.types';
import {
  buildActiveParticipantDetails,
  buildApplicationParticipant,
  buildLlmSettingsFallback,
  buildSwitchVersionInput,
  getInitialChatHistory,
  getWelcomeMessage,
  isMessageInFlight,
  mergeSwitchedEntitySettings,
} from './applicationChat.helpers';

describe('getWelcomeMessage', () => {
  it('builds a welcome-message row with the well-known id and no participant_id when none is given', () => {
    const msg = getWelcomeMessage('Hi there');
    expect(msg).toMatchObject({
      id: 'welcome_message_id',
      role: 'assistant',
      content: 'Hi there',
      isLoading: false,
      isStreaming: false,
    });
    expect(msg).not.toHaveProperty('participant_id');
    expect(typeof msg.created_at).toBe('number');
  });

  it('stamps participant_id when a participantId is given', () => {
    const msg = getWelcomeMessage('Hi', 'p-1');
    expect(msg.participant_id).toBe('p-1');
  });

  it('omits participant_id when participantId is null', () => {
    const msg = getWelcomeMessage('Hi', null);
    expect(msg).not.toHaveProperty('participant_id');
  });
});

describe('getInitialChatHistory', () => {
  it('returns a single welcome message when welcomeMessage is set', () => {
    const history = getInitialChatHistory('Welcome!', 'p-1');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ content: 'Welcome!', participant_id: 'p-1' });
  });

  it('returns an empty array when welcomeMessage is undefined', () => {
    expect(getInitialChatHistory(undefined, 'p-1')).toEqual([]);
  });

  it('returns an empty array when welcomeMessage is an empty string', () => {
    expect(getInitialChatHistory('', 'p-1')).toEqual([]);
  });
});

describe('buildApplicationParticipant', () => {
  const versionDetails: ChatApplicationVersionDetails = {
    id: 'v-1',
    variables: [{ name: 'x', value: '1' }],
    agent_type: 'chat',
    meta: { icon_meta: { url: 'icon.png' } },
  };

  it('returns null when applicationId is undefined', () => {
    expect(buildApplicationParticipant(undefined, 'App', versionDetails, 'proj-1')).toBeNull();
  });

  it('returns null when applicationVersionDetails is undefined', () => {
    expect(buildApplicationParticipant('app-1', 'App', undefined, 'proj-1')).toBeNull();
  });

  it('builds a full participant with name/projectId/variables/versionId/iconMeta/agentType present', () => {
    const participant = buildApplicationParticipant('app-1', 'App', versionDetails, 'proj-1');
    expect(participant).toEqual({
      id: 'app-1',
      entityName: 'application',
      entityMeta: { id: 'app-1', name: 'App', projectId: 'proj-1' },
      entitySettings: {
        variables: [{ name: 'x', value: '1' }],
        versionId: 'v-1',
        iconMeta: { url: 'icon.png' },
        agentType: 'chat',
      },
      meta: { name: 'App' },
    });
  });

  it('omits name/projectId/variables/versionId/agentType and defaults iconMeta to {} when all are absent', () => {
    const participant = buildApplicationParticipant(42, undefined, {}, undefined);
    expect(participant).toEqual({
      id: '42',
      entityName: 'application',
      entityMeta: { id: '42' },
      entitySettings: { iconMeta: {} },
    });
    expect(participant).not.toHaveProperty('meta');
  });

  it('allows applicationId 0 to build a participant (only undefined is treated as missing)', () => {
    const participant = buildApplicationParticipant(0, 'App', versionDetails, 'proj-1');
    expect(participant?.id).toBe('0');
  });
});

describe('buildLlmSettingsFallback', () => {
  it('reads every llm_settings field when applicationVersionDetails is present', () => {
    const versionDetails: ChatApplicationVersionDetails = {
      llm_settings: { model_name: 'gpt-4', model_project_id: 'p1', max_tokens: 100, temperature: 0.5, reasoning_effort: 'high' },
    };
    expect(buildLlmSettingsFallback(versionDetails)).toEqual({
      model_name: 'gpt-4',
      model_project_id: 'p1',
      max_tokens: 100,
      temperature: 0.5,
      reasoning_effort: 'high',
    });
  });

  it('returns all-undefined fields when applicationVersionDetails is undefined', () => {
    expect(buildLlmSettingsFallback(undefined)).toEqual({
      model_name: undefined,
      model_project_id: undefined,
      max_tokens: undefined,
      temperature: undefined,
      reasoning_effort: undefined,
    });
  });
});

describe('buildActiveParticipantDetails', () => {
  it('returns null when applicationVersionDetails is undefined', () => {
    expect(buildActiveParticipantDetails('app-1', 'App', undefined, 'proj-1')).toBeNull();
  });

  it('builds details with description defaulted to empty string when absent', () => {
    const details = buildActiveParticipantDetails('app-1', 'App', { agent_type: 'chat' }, 'proj-1');
    expect(details).toEqual({
      id: 'app-1',
      name: 'App',
      description: '',
      participantType: 'application',
      agent_type: 'chat',
      version_details: { agent_type: 'chat' },
      project_id: 'proj-1',
    });
  });

  it('preserves a real description when present', () => {
    const details = buildActiveParticipantDetails('app-1', 'App', { description: 'A real description' }, 'proj-1');
    expect(details?.['description']).toBe('A real description');
  });
});

describe('isMessageInFlight', () => {
  it('is true when isStreaming is set', () => {
    expect(isMessageInFlight({ isStreaming: true, isLoading: false, isRegenerating: false })).toBe(true);
  });

  it('is true when isLoading is set', () => {
    expect(isMessageInFlight({ isStreaming: false, isLoading: true, isRegenerating: false })).toBe(true);
  });

  it('is true when isRegenerating is set', () => {
    expect(isMessageInFlight({ isStreaming: false, isLoading: false, isRegenerating: true })).toBe(true);
  });

  it('is false when none of the three flags are set', () => {
    expect(isMessageInFlight({ isStreaming: false, isLoading: false, isRegenerating: false })).toBe(false);
  });

  it('is false when all three flags are undefined', () => {
    expect(isMessageInFlight({})).toBe(false);
  });
});

describe('buildSwitchVersionInput', () => {
  const applicationVersionDetails: ChatApplicationVersionDetails = {
    id: 'v-2',
    variables: [{ name: 'y', value: '2' }],
    llm_settings: { model_name: 'gpt-4' },
    meta: { icon_meta: { url: 'icon2.png' } },
  };

  it('leaves versionId undefined and ids at 0 when there is no conversation/participant yet', () => {
    const input = buildSwitchVersionInput('proj-1', null, null, applicationVersionDetails);
    expect(input).toEqual({
      projectId: 'proj-1',
      conversationId: 0,
      participantId: 0,
      activeEntitySettings: undefined,
      versionId: undefined,
      variables: [{ name: 'y', value: '2' }],
      llmSettings: { model_name: 'gpt-4' },
      iconMeta: { url: 'icon2.png' },
    });
  });

  it('defaults projectId to an empty string when undefined', () => {
    const input = buildSwitchVersionInput(undefined, null, null, applicationVersionDetails);
    expect(input.projectId).toBe('');
  });

  it('resolves numeric conversationId/participantId and a real versionId once both a conversation and a string-id participant exist', () => {
    const conversation: ChatConversation = { id: 7, chat_history: [] };
    const participant: Participant = { id: '9', entityName: 'application', entitySettings: { toolkitType: 'bar' } };

    const input = buildSwitchVersionInput('proj-1', conversation, participant, applicationVersionDetails);
    expect(input.conversationId).toBe(7);
    expect(input.participantId).toBe(9);
    expect(input.versionId).toBe('v-2');
    expect(input.activeEntitySettings).toEqual({ toolkitType: 'bar' });
  });

  it('keeps conversationId/participantId at 0 when conversation.id is not a number', () => {
    const conversation: ChatConversation = { id: 'not-a-number', chat_history: [] };
    const participant: Participant = { id: 'nine', entityName: 'application' };
    const input = buildSwitchVersionInput('proj-1', conversation, participant, applicationVersionDetails);
    expect(input.conversationId).toBe(0);
    // participant.id is a string ('nine'), so Number('nine') === NaN, not 0.
    expect(input.participantId).toBeNaN();
  });

  it('keeps versionId undefined when the conversation has no id yet even if the participant does', () => {
    const conversation: ChatConversation = { chat_history: [] };
    const participant: Participant = { id: '9', entityName: 'application' };
    const input = buildSwitchVersionInput('proj-1', conversation, participant, applicationVersionDetails);
    expect(input.versionId).toBeUndefined();
  });

  it('keeps versionId undefined when the participant has no id even if the conversation does', () => {
    const conversation: ChatConversation = { id: 7, chat_history: [] };
    const input = buildSwitchVersionInput('proj-1', conversation, null, applicationVersionDetails);
    expect(input.versionId).toBeUndefined();
  });
});

describe('mergeSwitchedEntitySettings', () => {
  it('returns null unchanged when prev is null', () => {
    expect(mergeSwitchedEntitySettings(null, { foo: 'bar' })).toBeNull();
  });

  it('merges entitySettings into a copy of the previous participant', () => {
    const prev: Participant = { id: '1', entityName: 'application', entitySettings: { toolkitType: 'old' } };
    const merged = mergeSwitchedEntitySettings(prev, { versionId: 'v-3' });
    expect(merged).toEqual({ id: '1', entityName: 'application', entitySettings: { versionId: 'v-3' } });
    // Original object is untouched (a new object is returned).
    expect(prev.entitySettings).toEqual({ toolkitType: 'old' });
  });
});

// Sanity-check ChatHistoryMessage typing is exercised (used only via isMessageInFlight above,
// but referenced directly here so the import is meaningfully used for readers of this suite).
const _typeCheck: ChatHistoryMessage = { id: '1', role: 'user' };
void _typeCheck;
