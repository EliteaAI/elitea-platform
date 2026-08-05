import { describe, expect, it, vi } from 'vitest';

import { ChatParticipantType } from '@/shared/lib/chat';

import { DEFAULT_LLM_SETTINGS, createToolkitConversationWithParticipant, findToolkitParticipant } from './toolkitConversation.helpers';

describe('DEFAULT_LLM_SETTINGS', () => {
  it('matches the baseline literal values (llmSettings.constants.js:7-8, top_k hardcoded 40)', () => {
    expect(DEFAULT_LLM_SETTINGS).toEqual({ temperature: 0.6, max_tokens: -1, top_k: 40 });
  });
});

describe('findToolkitParticipant', () => {
  it('finds the participant whose entity_name is Toolkits', () => {
    const conversation = {
      id: 'c1',
      participants: [
        { entity_name: ChatParticipantType.Users, entity_meta: { id: 'u1', project_id: undefined } },
        { entity_name: ChatParticipantType.Toolkits, entity_meta: { id: 'tk1', project_id: 'p1' } },
      ],
    };
    expect(findToolkitParticipant(conversation)?.entity_meta.id).toBe('tk1');
  });

  it('returns undefined when there is no toolkit participant', () => {
    expect(findToolkitParticipant({ id: 'c1', participants: [] })).toBeUndefined();
  });

  it('returns undefined for a null/undefined conversation', () => {
    expect(findToolkitParticipant(null)).toBeUndefined();
    expect(findToolkitParticipant(undefined)).toBeUndefined();
  });
});

describe('createToolkitConversationWithParticipant', () => {
  it('throws when toolkitId is missing', async () => {
    await expect(
      createToolkitConversationWithParticipant({
        createConversation: vi.fn(),
        addParticipant: vi.fn(),
        toolkitId: undefined,
        projectId: 'p1',
        values: {},
      }),
    ).rejects.toThrow('toolkitId is required to create a toolkit conversation');
  });

  it('returns null (without calling addParticipant) when createConversation resolves with no data', async () => {
    const addParticipant = vi.fn();
    const result = await createToolkitConversationWithParticipant({
      createConversation: vi.fn().mockResolvedValue({}),
      addParticipant,
      toolkitId: 'tk1',
      projectId: 'p1',
      values: { type: 'github', settings: {} },
    });
    expect(result).toBeNull();
    expect(addParticipant).not.toHaveBeenCalled();
  });

  it('creates the conversation with a single toolkit participant, then adds it, and merges the results', async () => {
    const createConversation = vi.fn().mockResolvedValue({
      data: { id: 'conv-1', uuid: 'uuid-1', participants: [{ entity_name: ChatParticipantType.Users, entity_meta: { id: 'u1', project_id: undefined } }] },
    });
    const addParticipant = vi.fn().mockResolvedValue({
      data: [{ entity_name: ChatParticipantType.Toolkits, entity_meta: { id: 'tk1', project_id: 'p1' } }],
    });

    const result = await createToolkitConversationWithParticipant({
      createConversation,
      addParticipant,
      toolkitId: 'tk1',
      projectId: 'p1',
      values: { type: 'github', settings: { repo: 'x' } },
      selectedModel: { name: 'gpt-4o-mini', project_id: 'p1' },
    });

    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        is_private: true,
        name: 'Toolkit conversation: tk1',
        source: ChatParticipantType.Toolkits,
      }),
    );

    const addParticipantArg = addParticipant.mock.calls[0]?.[0] as {
      readonly participants: readonly { readonly entity_settings: Record<string, unknown> }[];
    };
    expect(addParticipantArg.participants[0]?.entity_settings).toMatchObject({
      repo: 'x',
      toolkit_type: 'github',
      llm_settings: { model_name: 'gpt-4o-mini', model_project_id: 'p1', temperature: 0.6, max_tokens: -1, top_k: 40 },
    });

    expect(result?.id).toBe('conv-1');
    expect(result?.participants).toHaveLength(2);
  });

  it('uses meta.name as the conversation name when supplied', async () => {
    const createConversation = vi.fn().mockResolvedValue({ data: { id: 'c1', uuid: 'u1', participants: [] } });
    await createToolkitConversationWithParticipant({
      createConversation,
      addParticipant: vi.fn().mockResolvedValue({ data: [] }),
      toolkitId: 'tk1',
      projectId: 'p1',
      values: {},
      meta: { name: 'Custom Name' },
    });
    expect(createConversation).toHaveBeenCalledWith(expect.objectContaining({ name: 'Custom Name' }));
  });
});
