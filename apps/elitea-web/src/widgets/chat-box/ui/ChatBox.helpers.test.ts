import { describe, expect, it, vi } from 'vitest';

import type { Participant } from '@/entities/participant';

import {
  buildAgentEditorProps,
  buildTtsProps,
  buildUserParticipant,
  deriveChatBoxIds,
  deriveChatBoxInputState,
  deriveHitlChildThreadId,
  flattenChatBoxProps,
  optField,
  pickIdAndUuid,
  resolveConversationStarters,
  toLlmModel,
  toParticipant,
  toParticipants,
} from './ChatBox.helpers';

const PARTICIPANT: Participant = { id: '1', entityName: 'application' };

function baseParams() {
  return {
    participantForEditor: PARTICIPANT,
    activeParticipantDetails: undefined,
    isAgentsPage: false,
    selectSavedOrDefaultModel: undefined,
    onShowParticipantsList: undefined,
    onSelectVersion: () => {},
  };
}

describe('buildAgentEditorProps', () => {
  it('falls back to no-ops for every editor callback when editorCallbacks is undefined (pre-existing, backward-compatible behaviour)', () => {
    const props = buildAgentEditorProps({ ...baseParams(), editorCallbacks: undefined });

    expect(() => props.onShowAgentEditor?.(PARTICIPANT)).not.toThrow();
    expect(() => props.onShowPipelineEditor?.(PARTICIPANT)).not.toThrow();
    expect(() => props.onCloseAgentEditor?.()).not.toThrow();
    expect(() => props.onClosePipelineEditor?.()).not.toThrow();
  });

  it('routes to the real callbacks when editorCallbacks supplies them', () => {
    const onShowAgentEditor = vi.fn();
    const onShowPipelineEditor = vi.fn();
    const onCloseAgentEditor = vi.fn();
    const onClosePipelineEditor = vi.fn();

    const props = buildAgentEditorProps({
      ...baseParams(),
      editorCallbacks: { onShowAgentEditor, onShowPipelineEditor, onCloseAgentEditor, onClosePipelineEditor },
    });

    props.onShowAgentEditor?.(PARTICIPANT);
    props.onShowPipelineEditor?.(PARTICIPANT);
    props.onCloseAgentEditor?.();
    props.onClosePipelineEditor?.();

    expect(onShowAgentEditor).toHaveBeenCalledExactlyOnceWith(PARTICIPANT);
    expect(onShowPipelineEditor).toHaveBeenCalledExactlyOnceWith(PARTICIPANT);
    expect(onCloseAgentEditor).toHaveBeenCalledTimes(1);
    expect(onClosePipelineEditor).toHaveBeenCalledTimes(1);
  });

  it('falls back to a no-op per-field when only some editorCallbacks fields are supplied', () => {
    const onShowAgentEditor = vi.fn();
    const props = buildAgentEditorProps({ ...baseParams(), editorCallbacks: { onShowAgentEditor } });

    props.onShowAgentEditor?.(PARTICIPANT);
    expect(onShowAgentEditor).toHaveBeenCalledExactlyOnceWith(PARTICIPANT);
    expect(() => props.onClosePipelineEditor?.()).not.toThrow();
  });
});

describe('deriveHitlChildThreadId', () => {
  it('returns undefined when toolCallId is falsy', () => {
    expect(deriveHitlChildThreadId({ hitlInterrupts: [] }, undefined)).toBeUndefined();
  });

  it('returns thread_id from matching entry', () => {
    const msg = { hitlInterrupts: [{ tool_call_id: 'tc1', thread_id: 'tid1' }] };
    expect(deriveHitlChildThreadId(msg, 'tc1')).toBe('tid1');
  });

  it('falls back to child_thread_id', () => {
    const msg = { hitlInterrupts: [{ tool_call_id: 'tc1', child_thread_id: 'ctid' }] };
    expect(deriveHitlChildThreadId(msg, 'tc1')).toBe('ctid');
  });

  it('returns undefined when no match', () => {
    expect(deriveHitlChildThreadId({ hitlInterrupts: [{ tool_call_id: 'other' }] }, 'tc1')).toBeUndefined();
  });

  it('returns undefined for undefined message', () => {
    expect(deriveHitlChildThreadId(undefined, 'tc1')).toBeUndefined();
  });
});

describe('buildUserParticipant', () => {
  it('includes all defined fields', () => {
    expect(buildUserParticipant('u1', 'Alice', 'a.png')).toEqual({ id: 'u1', name: 'Alice', avatar: 'a.png' });
  });

  it('omits undefined fields', () => {
    const result = buildUserParticipant(undefined, 'Bob', undefined);
    expect(result).toEqual({ name: 'Bob' });
    expect('id' in result).toBe(false);
  });
});

describe('pickIdAndUuid', () => {
  it('picks both when present', () => {
    expect(pickIdAndUuid({ id: 42, uuid: 'abc' })).toEqual({ id: 42, uuid: 'abc' });
  });

  it('omits undefined fields', () => {
    const result = pickIdAndUuid({ id: 1 });
    expect('uuid' in result).toBe(false);
  });
});

describe('optField', () => {
  it('returns {key: value} when defined', () => {
    expect(optField('x', 5)).toEqual({ x: 5 });
  });

  it('returns empty when undefined', () => {
    expect(optField('x', undefined)).toEqual({});
  });
});

describe('toParticipant', () => {
  it('returns undefined for non-object or missing id', () => {
    expect(toParticipant(null)).toBeUndefined();
    expect(toParticipant({})).toBeUndefined();
  });

  it('normalizes a valid wire participant', () => {
    expect(toParticipant({ id: '1', entity_name: 'user' })).toEqual({ id: '1', entityName: 'user' });
  });

  it('coerces numeric id to string', () => {
    expect(toParticipant({ id: 99, entity_name: 'llm' })?.id).toBe('99');
  });

  it('defaults unknown entity_name to dummy', () => {
    expect(toParticipant({ id: '1', entity_name: 'unknown' })?.entityName).toBe('dummy');
  });

  it('builds entityMeta/meta/entitySettings', () => {
    const result = toParticipant({
      id: '1', entity_name: 'toolkit',
      entity_meta: { id: 'em', name: 'Tool', project_id: 'p1' },
      meta: { id: 'm1', user_name: 'usr', user_avatar: 'av', is_container: true, mcp: true },
      entity_settings: {
        version_id: 'v2', toolkit_type: 'mcp', variables: [1], agent_type: 'pipeline', mcp_server_url: 'https://mcp.example',
      },
    });
    expect(result).toEqual({
      id: '1',
      entityName: 'toolkit',
      entityMeta: { id: 'em', name: 'Tool', projectId: 'p1' },
      meta: { id: 'm1', userName: 'usr', userAvatar: 'av', isContainer: true, mcp: true },
      entitySettings: {
        versionId: 'v2', toolkitType: 'mcp', variables: [1], agentType: 'pipeline', mcpServerUrl: 'https://mcp.example',
      },
    });
  });
});

describe('toParticipants', () => {
  it('returns undefined for undefined input', () => {
    expect(toParticipants(undefined)).toBeUndefined();
  });

  it('filters invalid entries', () => {
    expect(toParticipants([{ id: '1', entity_name: 'user' }, null, {}])).toHaveLength(1);
  });
});

describe('buildTtsProps', () => {
  it('converts null values to undefined', () => {
    const result = buildTtsProps({
      onAutoSpeak: () => {}, speakingMessageId: null, speakingSegments: null, spokenRange: null,
    });
    expect(result.speakingMessageId).toBeUndefined();
    expect(result.speakingSegments).toBeUndefined();
    expect(result.spokenRange).toBeUndefined();
  });

  it('stringifies numeric speakingMessageId', () => {
    const result = buildTtsProps({
      onAutoSpeak: () => {}, speakingMessageId: 42, speakingSegments: [], spokenRange: { start: 0, end: 5 },
    });
    expect(result.speakingMessageId).toBe('42');
  });
});

describe('toLlmModel', () => {
  it('uses name as id when id is undefined', () => {
    expect(toLlmModel({ name: 'claude' } as never).id).toBe('claude');
  });

  it('stringifies numeric id', () => {
    expect(toLlmModel({ id: 7, name: 'gpt' } as never).id).toBe('7');
  });

  it('includes optional boolean/number fields when present', () => {
    const result = toLlmModel({ id: 1, name: 'x', shared: true, supports_vision: false, max_output_tokens: 4096 } as never);
    expect(result.shared).toBe(true);
    expect(result.supports_vision).toBe(false);
    expect(result.max_output_tokens).toBe(4096);
  });
});

describe('deriveChatBoxInputState', () => {
  const base = {
    isLoadingConversation: false, isFetchingParticipantDetails: false,
    isUploadingAttachments: false, isUpdatingInternalToolsConfig: false,
    isConversationSending: false, isStreaming: false,
    hasChatInput: true, isProcessingSymbols: false,
    hasPendingHitlInterrupt: false, isActiveParticipantBroken: false,
  };

  it('not loading/disabled when all false', () => {
    const r = deriveChatBoxInputState(base);
    expect(r.isInputLoading).toBe(false);
    expect(r.disabledSend).toBe(false);
  });

  it('loading when streaming', () => {
    expect(deriveChatBoxInputState({ ...base, isStreaming: true }).isInputLoading).toBe(true);
  });

  it('disabled when no chat input', () => {
    expect(deriveChatBoxInputState({ ...base, hasChatInput: false }).disabledSend).toBe(true);
  });

  it('disabled when broken participant', () => {
    expect(deriveChatBoxInputState({ ...base, isActiveParticipantBroken: true }).disabledSend).toBe(true);
  });
});

describe('flattenChatBoxProps', () => {
  it('extracts nested fields', () => {
    const r = flattenChatBoxProps({ user: { id: 'u', name: 'N', avatar: 'a' } });
    expect(r.userId).toBe('u');
    expect(r.userName).toBe('N');
  });

  it('handles empty props', () => {
    const r = flattenChatBoxProps({});
    expect(r.userId).toBeUndefined();
  });
});

describe('deriveChatBoxIds', () => {
  it('extracts from activeConversation', () => {
    const r = deriveChatBoxIds({ id: 1, uuid: 'u', isSending: true }, 42);
    expect(r.conversationId).toBe(1);
    expect(r.projectIdString).toBe('42');
    expect(r.isConversationSending).toBe(true);
  });

  it('handles undefined', () => {
    const r = deriveChatBoxIds(undefined, undefined);
    expect(r.conversationId).toBeUndefined();
    expect(r.projectIdString).toBeUndefined();
  });
});

describe('resolveConversationStarters', () => {
  const starters = [{ id: '1', text: 'Hi' }];

  it('returns starters when fresh', () => {
    expect(resolveConversationStarters(false, 0, starters)).toBe(starters);
  });

  it('returns empty when starter sent', () => {
    expect(resolveConversationStarters(true, 0, starters)).toEqual([]);
  });

  it('returns empty when messages exist', () => {
    expect(resolveConversationStarters(false, 5, starters)).toEqual([]);
  });
});
