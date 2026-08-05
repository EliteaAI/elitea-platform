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
});
