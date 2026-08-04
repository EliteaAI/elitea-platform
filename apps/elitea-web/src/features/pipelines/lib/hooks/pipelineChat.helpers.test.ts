import { describe, expect, it } from 'vitest';

import {
  buildActiveParticipantDetails,
  buildLlmSettingsFallback,
  buildPipelineParticipant,
  buildSwitchVersionInput,
  getInitialChatHistory,
  getWelcomeMessage,
  isMessageInFlight,
  mergeSwitchedEntitySettings,
} from './pipelineChat.helpers';

describe('getWelcomeMessage', () => {
  it('builds an assistant welcome message with the well-known id', () => {
    const message = getWelcomeMessage('Hi there', 'p1');
    expect(message.id).toBe('welcome_message_id');
    expect(message.role).toBe('assistant');
    expect(message.content).toBe('Hi there');
    expect(message.participant_id).toBe('p1');
  });

  it('omits participant_id when not given', () => {
    const message = getWelcomeMessage('Hi');
    expect('participant_id' in message).toBe(false);
  });
});

describe('getInitialChatHistory', () => {
  it('returns a single welcome message when welcomeMessage is set', () => {
    expect(getInitialChatHistory('Hi', 'p1')).toHaveLength(1);
  });

  it('returns an empty array when welcomeMessage is undefined', () => {
    expect(getInitialChatHistory(undefined, 'p1')).toEqual([]);
  });
});

describe('buildPipelineParticipant', () => {
  it('returns null when pipelineId or pipelineVersionDetails is missing', () => {
    expect(buildPipelineParticipant(undefined, 'name', { id: 1 }, 'p1')).toBeNull();
    expect(buildPipelineParticipant('1', 'name', undefined, 'p1')).toBeNull();
  });

  it('builds an application-typed participant with entitySettings derived from the version', () => {
    const participant = buildPipelineParticipant(
      '10',
      'My Pipeline',
      { id: 5, variables: [{ name: 'x' }], agent_type: 'pipeline', meta: { icon_meta: { url: 'a.png' } } },
      'proj-1',
    );
    expect(participant).toMatchObject({
      id: '10',
      entityName: 'application',
      entityMeta: { id: '10', name: 'My Pipeline', projectId: 'proj-1' },
      entitySettings: {
        variables: [{ name: 'x' }],
        versionId: 5,
        iconMeta: { url: 'a.png' },
        agentType: 'pipeline',
      },
      meta: { name: 'My Pipeline' },
    });
  });
});

describe('buildLlmSettingsFallback', () => {
  it('reads through to llm_settings fields, defaulting to undefined when missing (and no projectId to fall back to)', () => {
    expect(buildLlmSettingsFallback(undefined, undefined)).toEqual({
      model_name: undefined,
      model_project_id: undefined,
      max_tokens: undefined,
      temperature: undefined,
      reasoning_effort: undefined,
    });
    expect(buildLlmSettingsFallback({ llm_settings: { model_name: 'gpt-4', temperature: 0.5 } }, undefined)).toMatchObject({
      model_name: 'gpt-4',
      temperature: 0.5,
    });
  });

  it('falls back model_project_id to the current projectId when the version has none (baseline `usePipelineChat.hooks.js:331-334`\'s final `|| projectId` link)', () => {
    expect(buildLlmSettingsFallback(undefined, 'proj-1')).toMatchObject({ model_project_id: 'proj-1' });
    expect(buildLlmSettingsFallback({ llm_settings: { model_name: 'gpt-4' } }, 'proj-1')).toMatchObject({
      model_project_id: 'proj-1',
    });
  });

  it('prefers the version-level model_project_id over projectId when both are present', () => {
    expect(buildLlmSettingsFallback({ llm_settings: { model_project_id: 'version-proj' } }, 'proj-1')).toMatchObject({
      model_project_id: 'version-proj',
    });
  });
});

describe('buildActiveParticipantDetails', () => {
  it('returns null when there is no version details', () => {
    expect(buildActiveParticipantDetails('1', 'name', undefined, 'p1')).toBeNull();
  });

  it('defaults agent_type to "pipeline" when the version omits it', () => {
    const details = buildActiveParticipantDetails('1', 'My Pipeline', { id: 5 }, 'p1');
    expect(details).toMatchObject({ id: '1', name: 'My Pipeline', agent_type: 'pipeline', project_id: 'p1' });
  });

  it('preserves an explicit agent_type', () => {
    const details = buildActiveParticipantDetails('1', 'name', { id: 5, agent_type: 'chat' }, 'p1');
    expect(details).toMatchObject({ agent_type: 'chat' });
  });
});

describe('isMessageInFlight', () => {
  it('is true for streaming/loading/regenerating', () => {
    expect(isMessageInFlight({ isStreaming: true })).toBe(true);
    expect(isMessageInFlight({ isLoading: true })).toBe(true);
    expect(isMessageInFlight({ isRegenerating: true })).toBe(true);
  });

  it('is false for a settled message', () => {
    expect(isMessageInFlight({})).toBe(false);
  });
});

describe('buildSwitchVersionInput', () => {
  it('leaves versionId undefined until both a conversation id and participant id exist (first version is never a switch)', () => {
    const input = buildSwitchVersionInput('p1', null, null, { id: 5 });
    expect(input.versionId).toBeUndefined();
  });

  it('sets versionId once a conversation and participant are both resolved', () => {
    const input = buildSwitchVersionInput(
      'p1',
      { id: 7, chat_history: [] },
      { id: '9', entityName: 'application', entityMeta: {}, entitySettings: {} },
      { id: 5, variables: [{ name: 'x' }], llm_settings: { model_name: 'gpt' }, meta: { icon_meta: { a: 1 } } },
    );
    expect(input).toMatchObject({
      projectId: 'p1',
      conversationId: 7,
      participantId: 9,
      versionId: 5,
      variables: [{ name: 'x' }],
      llmSettings: { model_name: 'gpt' },
      iconMeta: { a: 1 },
    });
  });
});

describe('mergeSwitchedEntitySettings', () => {
  it('merges entitySettings into the previous participant', () => {
    const prev = { id: '1', entityName: 'application' as const, entityMeta: {}, entitySettings: { versionId: 1 } };
    expect(mergeSwitchedEntitySettings(prev, { versionId: 2 })).toEqual({ ...prev, entitySettings: { versionId: 2 } });
  });

  it('returns null unchanged when there is no previous participant', () => {
    expect(mergeSwitchedEntitySettings(null, { versionId: 2 })).toBeNull();
  });
});
