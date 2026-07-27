import { describe, expect, it } from 'vitest';

import {
  CANVAS_ADMIN_USER,
  CANVAS_SYSTEM_USER,
  ChatParticipantType,
  TOOL_ACTION_NAMES,
  TOOL_ACTION_TYPES,
  ToolActionStatus,
  areTheSameConversations,
  areTheSameFolders,
  dummyConversation,
  dummyFolder,
  genConversationId,
  getRawParticipantUniqueId,
} from './chat';

describe('getRawParticipantUniqueId', () => {
  it('returns "" for a nullish participant', () => {
    expect(getRawParticipantUniqueId(undefined)).toBe('');
    expect(getRawParticipantUniqueId(null)).toBe('');
  });

  it('uses ChatParticipantType.Pipelines when agent_type is pipeline, regardless of participantType', () => {
    const id = getRawParticipantUniqueId({
      agent_type: ChatParticipantType.Pipelines,
      participantType: ChatParticipantType.Applications,
      id: '7',
      project_id: 'p1',
    });
    expect(id).toBe('pipeline_7_p1');
  });

  it('uses model_name-integration_uid for Models participants', () => {
    const id = getRawParticipantUniqueId({
      participantType: ChatParticipantType.Models,
      model_name: 'gpt-4',
      integration_uid: 'uid-1',
      project_id: 'p1',
    });
    expect(id).toBe('llm_gpt-4-uid-1_p1');
  });

  it('uses id for non-model participants', () => {
    const id = getRawParticipantUniqueId({
      participantType: ChatParticipantType.Applications,
      id: 'agent-1',
      project_id: 'p1',
    });
    expect(id).toBe('application_agent-1_p1');
  });

  it('defaults project_id to "" when absent', () => {
    const id = getRawParticipantUniqueId({ participantType: ChatParticipantType.Users, id: 'u1' });
    expect(id).toBe('user_u1_');
  });
});

describe('areTheSameConversations', () => {
  it('requires both id and isPlayback-ness to match', () => {
    expect(areTheSameConversations({ id: '1', isPlayback: true }, { id: '1', isPlayback: true })).toBe(true);
    expect(areTheSameConversations({ id: '1', isPlayback: true }, { id: '1', isPlayback: false })).toBe(false);
    expect(areTheSameConversations({ id: '1' }, { id: '2' })).toBe(false);
  });

  it('returns false when either conversation is nullish', () => {
    expect(areTheSameConversations(null, { id: '1' })).toBe(false);
    expect(areTheSameConversations({ id: '1' }, undefined)).toBe(false);
  });

  it('coerces isPlayback truthiness (1 == true)', () => {
    expect(areTheSameConversations({ id: '1', isPlayback: 1 }, { id: '1', isPlayback: true })).toBe(true);
  });
});

describe('areTheSameFolders', () => {
  it('compares by id only', () => {
    expect(areTheSameFolders({ id: 'a' }, { id: 'a' })).toBe(true);
    expect(areTheSameFolders({ id: 'a' }, { id: 'b' })).toBe(false);
  });

  it('returns false when either folder is nullish', () => {
    expect(areTheSameFolders(null, { id: 'a' })).toBe(false);
  });
});

describe('genConversationId', () => {
  it('composes id and isPlayback into a single string key', () => {
    expect(genConversationId({ id: '5', isPlayback: false })).toBe('5_isPlayback_false');
  });

  it('handles an undefined conversation via optional chaining (parity)', () => {
    expect(genConversationId(undefined)).toBe('undefined_isPlayback_undefined');
  });
});

describe('chat constants', () => {
  it('dummyConversation / dummyFolder are the expected empty shapes', () => {
    expect(dummyConversation).toEqual({ name: '', chat_history: [], participants: [], is_private: true });
    expect(dummyFolder).toEqual({ name: '', conversations: [] });
  });

  it('exposes the canvas pseudo-user identifiers', () => {
    expect(CANVAS_ADMIN_USER).toBe('admin@centry.user');
    expect(CANVAS_SYSTEM_USER).toBe('system@centry.user');
  });

  it('exposes tool-action type/name/status catalogues', () => {
    expect(TOOL_ACTION_TYPES.Toolkit).toBe('toolkit');
    expect(TOOL_ACTION_NAMES.Toolkit).toBe('Toolkit thinking step');
    expect(ToolActionStatus.error).toBe('error');
  });
});
