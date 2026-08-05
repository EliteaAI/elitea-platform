import { describe, expect, it } from 'vitest';

import { conversationStarterToString } from './conversationStarters.helpers';

describe('conversationStarterToString', () => {
  it('returns an empty string for null/undefined', () => {
    expect(conversationStarterToString(null)).toBe('');
    expect(conversationStarterToString(undefined)).toBe('');
  });

  it('passes a string through unchanged', () => {
    expect(conversationStarterToString('Hello there')).toBe('Hello there');
  });

  it('stringifies numbers and booleans', () => {
    expect(conversationStarterToString(42)).toBe('42');
    expect(conversationStarterToString(true)).toBe('true');
    expect(conversationStarterToString(false)).toBe('false');
  });

  it('stringifies an empty string as itself, not as empty', () => {
    expect(conversationStarterToString('')).toBe('');
  });
});
