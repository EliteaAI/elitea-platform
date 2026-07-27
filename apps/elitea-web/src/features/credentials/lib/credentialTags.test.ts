import { describe, expect, it } from 'vitest';

import type { Credential } from '@/entities/credential';

import { generateCredentialTagList } from './credentialTags';

function cred(type: string): Credential {
  return { id: type, type };
}

describe('generateCredentialTagList', () => {
  it('returns one tag per distinct type with a count', () => {
    const tags = generateCredentialTagList([cred('openai'), cred('openai'), cred('azure_devops')]);
    expect(tags).toHaveLength(2);
    const openai = tags.find((t) => t.data.type === 'openai');
    expect(openai?.credentialCount).toBe(2);
  });

  it('sorts alphabetically by display name', () => {
    const tags = generateCredentialTagList([cred('zendesk'), cred('azure_devops')]);
    expect(tags.map((t) => t.name)).toEqual(['Azure devops', 'Zendesk']);
  });

  it('returns an empty list for no credentials', () => {
    expect(generateCredentialTagList([])).toEqual([]);
  });
});
