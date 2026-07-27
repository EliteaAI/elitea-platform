import { describe, expect, it } from 'vitest';

import { sortUsersByName, userHasRole, userInitials } from './selectors';
import type { User } from './types';

const user = (id: string, name: string, roles: readonly string[] = []): User => ({
  id,
  name,
  email: `${id}@example.com`,
  roles,
});

describe('userInitials', () => {
  it('takes the first letter of the first and last word', () => {
    expect(userInitials(user('1', 'Ada Lovelace'))).toBe('AL');
  });

  it('handles a single-word name', () => {
    expect(userInitials(user('1', 'Ada'))).toBe('A');
  });

  it('handles multi-word names by using only the first and last', () => {
    expect(userInitials(user('1', 'Ada Byron Lovelace'))).toBe('AL');
  });

  it('collapses extra whitespace', () => {
    expect(userInitials(user('1', '  Ada   Lovelace  '))).toBe('AL');
  });

  it('returns an empty string for a blank name', () => {
    expect(userInitials(user('1', '   '))).toBe('');
  });
});

describe('userHasRole', () => {
  it('is true when the role is present', () => {
    expect(userHasRole(user('1', 'A', ['admin', 'editor']), 'editor')).toBe(true);
  });

  it('is false when the role is absent', () => {
    expect(userHasRole(user('1', 'A', ['viewer']), 'admin')).toBe(false);
  });

  it('is false for an empty roles array', () => {
    expect(userHasRole(user('1', 'A', []), 'admin')).toBe(false);
  });
});

describe('sortUsersByName', () => {
  it('sorts case-insensitively', () => {
    const users = [user('1', 'zeta'), user('2', 'Alpha')];
    expect(sortUsersByName(users).map((u) => u.id)).toEqual(['2', '1']);
  });

  it('does not mutate the input', () => {
    const users = [user('1', 'b'), user('2', 'a')];
    const copy = [...users];
    sortUsersByName(users);
    expect(users).toEqual(copy);
  });
});
