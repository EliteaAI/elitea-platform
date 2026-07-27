import { describe, expect, it } from 'vitest';

import { authorDisplayName, isCurrentUserAuthor, isSameAuthor } from './selectors';
import type { Author } from './types';

const author = (id: string, name: string, email = `${id}@example.com`): Author => ({ id, name, email });

describe('authorDisplayName', () => {
  it('returns the name when non-blank', () => {
    expect(authorDisplayName(author('1', 'Ada Lovelace'))).toBe('Ada Lovelace');
  });

  it('falls back to email when the name is blank', () => {
    expect(authorDisplayName(author('1', '   ', 'ada@example.com'))).toBe('ada@example.com');
  });
});

describe('isSameAuthor', () => {
  it('is true for matching ids regardless of other fields', () => {
    expect(isSameAuthor(author('1', 'A'), author('1', 'B', 'b@example.com'))).toBe(true);
  });

  it('is false for different ids', () => {
    expect(isSameAuthor(author('1', 'A'), author('2', 'A'))).toBe(false);
  });
});

describe('isCurrentUserAuthor', () => {
  it('is true when the id matches', () => {
    expect(isCurrentUserAuthor(author('1', 'A'), '1')).toBe(true);
  });

  it('is false when the id differs', () => {
    expect(isCurrentUserAuthor(author('1', 'A'), '2')).toBe(false);
  });

  it('is false when there is no current user', () => {
    expect(isCurrentUserAuthor(author('1', 'A'), undefined)).toBe(false);
  });
});
