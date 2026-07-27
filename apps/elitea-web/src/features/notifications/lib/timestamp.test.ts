import { describe, expect, it } from 'vitest';

import { normalizeNotificationTimestamp } from './timestamp';

describe('normalizeNotificationTimestamp', () => {
  it('joins a space-separated naive timestamp with T...Z (convertChatConversationMessages.js:22-24)', () => {
    expect(normalizeNotificationTimestamp('2026-01-01 12:00:00')).toBe('2026-01-01T12:00:00Z');
  });

  it('leaves a string already ending in Z unchanged', () => {
    expect(normalizeNotificationTimestamp('2026-01-01T12:00:00Z')).toBe('2026-01-01T12:00:00Z');
  });

  it('leaves a string carrying an explicit +offset unchanged', () => {
    expect(normalizeNotificationTimestamp('2026-01-01T12:00:00+02:00')).toBe('2026-01-01T12:00:00+02:00');
  });

  it('appends Z to a bare ISO string with no offset and no space', () => {
    expect(normalizeNotificationTimestamp('2026-01-01T12:00:00')).toBe('2026-01-01T12:00:00Z');
  });

  it('produces a Date-parseable UTC string', () => {
    const normalized = normalizeNotificationTimestamp('2026-01-01 12:00:00');
    expect(new Date(normalized).toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });
});
