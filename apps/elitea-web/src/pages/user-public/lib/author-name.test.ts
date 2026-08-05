import { describe, expect, it } from 'vitest';

import { resolveAuthorName } from './author-name';

describe('resolveAuthorName (parity: apps/elitea-ui/src/hooks/useAuthorName.js)', () => {
  it('prefers a non-empty URL-provided name over the server name', () => {
    expect(resolveAuthorName('Ada Lovelace', 'Server Name')).toBe('Ada Lovelace');
  });

  it('falls back to the server name when the URL name is the empty string', () => {
    expect(resolveAuthorName('', 'Server Name')).toBe('Server Name');
  });

  it('falls back to the empty string when neither is available', () => {
    expect(resolveAuthorName('', undefined)).toBe('');
  });

  it('treats a whitespace-only URL name as truthy, matching `||` (not `.trim()`)', () => {
    expect(resolveAuthorName(' ', 'Server Name')).toBe(' ');
  });
});
