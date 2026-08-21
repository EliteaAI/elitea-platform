import { describe, expect, it } from 'vitest';

import { extractFirstName, extractHumanReadableName, getChatUserSettings, setUserLLmSettings } from './newConversation.helpers';

describe('extractHumanReadableName', () => {
  it('humanizes an email local-part', () => {
    expect(extractHumanReadableName('john.doe-smith_jr@example.com')).toBe('John Doe Smith Jr');
  });

  it('is empty for a falsy input', () => {
    expect(extractHumanReadableName(undefined)).toBe('');
    expect(extractHumanReadableName('')).toBe('');
  });
});

describe('extractFirstName', () => {
  it('takes the first word', () => {
    expect(extractFirstName('Jane Doe')).toBe('Jane');
  });

  it('is empty for a falsy input', () => {
    expect(extractFirstName(undefined)).toBe('');
    expect(extractFirstName('')).toBe('');
  });
});

describe('getChatUserSettings', () => {
  it('finds the user participant llm_settings', () => {
    const conversation = { participants: [{ entity_name: 'user', entity_meta: { id: 'u1' }, entity_settings: { llm_settings: { model_name: 'gpt-4' } } }] };
    expect(getChatUserSettings(conversation, 'u1')).toEqual({ model_name: 'gpt-4' });
  });

  it('is undefined when no matching user participant exists', () => {
    expect(getChatUserSettings({ participants: [] }, 'u1')).toBeUndefined();
    expect(getChatUserSettings(undefined, 'u1')).toBeUndefined();
  });

  /**
   * DEFECT: the predicate was `p.entity_meta?.id === userId`, a strict compare
   * between a NUMBER and a STRING. Every producer writes `entity_meta.id` as a
   * JSON number (`useChatBoxSend.ts` writes `Number(userId)`; the legacy
   * pydantic model declares `id: int`), and every caller passes `userId` as a
   * string (`/social/author` answers `{"id":"5"}`). So `5 === '5'` was false
   * for every row. The lookup always returned undefined. The conversation
   * opened on the project default model instead of the saved one.
   *
   * EVIDENCE: the old case above passes only because it feeds
   * `entity_meta: { id: 'u1' }` — a string no producer ever writes.
   */
  it('matches a numeric participant id against a string user id', () => {
    const conversation = { participants: [{ entity_name: 'user', entity_meta: { id: 5 }, entity_settings: { llm_settings: { model_name: 'gpt-4' } } }] };
    expect(getChatUserSettings(conversation, '5')).toEqual({ model_name: 'gpt-4' });
  });

  it('does not match a participant with no id while the user id is still unknown', () => {
    const conversation = { participants: [{ entity_name: 'user', entity_settings: { llm_settings: { model_name: 'gpt-4' } } }] };
    expect(getChatUserSettings(conversation, undefined)).toBeUndefined();
    expect(getChatUserSettings(conversation, '5')).toBeUndefined();
  });
});

describe('setUserLLmSettings', () => {
  it('merges llm_settings onto the matching user participant only', () => {
    const participants = [
      { entity_name: 'user', entity_meta: { id: 'u1' }, entity_settings: { llm_settings: { model_name: 'old' } } },
      { entity_name: 'toolkit', entity_meta: { id: 'u1' } },
    ];
    const result = setUserLLmSettings(participants, 'u1', { temperature: 0.5 });
    expect(result[0]?.entity_settings?.llm_settings).toEqual({ model_name: 'old', temperature: 0.5 });
    expect(result[1]).toEqual(participants[1]);
  });

  it('is a no-op array when there are no participants', () => {
    expect(setUserLLmSettings(undefined, 'u1', {})).toEqual([]);
  });

  /** Same number-versus-string defect as `getChatUserSettings` — the write predicate was identical. */
  it('merges onto a participant whose id is a number', () => {
    const participants = [{ entity_name: 'user', entity_meta: { id: 5 }, entity_settings: { llm_settings: { model_name: 'old' } } }];
    const result = setUserLLmSettings(participants, '5', { temperature: 0.5 });
    expect(result[0]?.entity_settings?.llm_settings).toEqual({ model_name: 'old', temperature: 0.5 });
  });

  it('does not merge onto a participant with no id when the user id is unknown', () => {
    const participants = [{ entity_name: 'user', entity_settings: { llm_settings: { model_name: 'old' } } }];
    expect(setUserLLmSettings(participants, undefined, { temperature: 0.5 })).toEqual(participants);
  });
});
