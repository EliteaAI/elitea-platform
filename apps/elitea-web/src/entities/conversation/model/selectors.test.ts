import { describe, expect, it } from 'vitest';

import { hasPlaybackConversation, isPinnedConversation, sortConversations } from './selectors';
import type { Conversation } from './types';

const conversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: '1',
  name: 'Chat',
  isPrivate: true,
  ...overrides,
});

describe('sortConversations', () => {
  it('orders by updatedAt descending', () => {
    const older = conversation({ id: 'a', updatedAt: '2026-01-01T00:00:00Z' });
    const newer = conversation({ id: 'b', updatedAt: '2026-01-05T00:00:00Z' });
    expect(sortConversations([older, newer]).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('falls back to createdAt when updatedAt is absent', () => {
    const older = conversation({ id: 'a', createdAt: '2026-01-01T00:00:00Z' });
    const newer = conversation({ id: 'b', createdAt: '2026-01-05T00:00:00Z' });
    expect(sortConversations([older, newer]).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('breaks a same-date tie between DIFFERENT conversations by isPlayback, order (normal, playback)', () => {
    const same = '2026-01-01T00:00:00Z';
    const normal = conversation({ id: 'a', updatedAt: same });
    const playback = conversation({ id: 'b', updatedAt: same, isPlayback: true });
    expect(sortConversations([normal, playback]).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('breaks a same-date tie between DIFFERENT conversations by isPlayback, order (playback, normal)', () => {
    const same = '2026-01-01T00:00:00Z';
    const normal = conversation({ id: 'a', updatedAt: same });
    const playback = conversation({ id: 'b', updatedAt: same, isPlayback: true });
    expect(sortConversations([playback, normal]).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('is stable (returns 0) for two DIFFERENT conversations tied on date and isPlayback', () => {
    const same = '2026-01-01T00:00:00Z';
    const a = conversation({ id: 'a', updatedAt: same });
    const b = conversation({ id: 'b', updatedAt: same });
    expect(sortConversations([a, b]).map((c) => c.id)).toEqual(['a', 'b']);
    expect(sortConversations([b, a]).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('prefers isPlayback BEFORE date when two rows share the same id, order (newer, older)', () => {
    const older = conversation({ id: 'x', updatedAt: '2020-01-01T00:00:00Z', isPlayback: true });
    const newer = conversation({ id: 'x', updatedAt: '2026-01-01T00:00:00Z', isPlayback: false });
    // Same id: isPlayback wins even though `newer` has a later date.
    expect(sortConversations([newer, older])[0]).toBe(older);
  });

  it('prefers isPlayback BEFORE date when two rows share the same id, order (older, newer)', () => {
    const older = conversation({ id: 'x', updatedAt: '2020-01-01T00:00:00Z', isPlayback: true });
    const newer = conversation({ id: 'x', updatedAt: '2026-01-01T00:00:00Z', isPlayback: false });
    expect(sortConversations([older, newer])[0]).toBe(older);
  });

  it('falls back to date when two same-id rows have equal isPlayback state, order (older, newer)', () => {
    const older = conversation({ id: 'x', updatedAt: '2020-01-01T00:00:00Z', isPlayback: true });
    const newer = conversation({ id: 'x', updatedAt: '2026-01-01T00:00:00Z', isPlayback: true });
    expect(sortConversations([older, newer])[0]).toBe(newer);
  });

  it('falls back to date when two same-id rows have equal isPlayback state, order (newer, older)', () => {
    const older = conversation({ id: 'x', updatedAt: '2020-01-01T00:00:00Z', isPlayback: true });
    const newer = conversation({ id: 'x', updatedAt: '2026-01-01T00:00:00Z', isPlayback: true });
    expect(sortConversations([newer, older])[0]).toBe(newer);
  });

  it('is stable (returns 0) for two same-id rows tied on date and isPlayback', () => {
    const same = '2026-01-01T00:00:00Z';
    const first = conversation({ id: 'x', updatedAt: same, name: 'first' });
    const second = conversation({ id: 'x', updatedAt: same, name: 'second' });
    expect(sortConversations([first, second]).map((c) => c.name)).toEqual(['first', 'second']);
  });

  it('does not mutate the input array', () => {
    const list = [conversation({ id: 'a', updatedAt: '2026-01-01T00:00:00Z' }), conversation({ id: 'b', updatedAt: '2026-01-02T00:00:00Z' })];
    const copy = [...list];
    sortConversations(list);
    expect(list).toEqual(copy);
  });
});

describe('hasPlaybackConversation', () => {
  it('is true when a playback row with the matching id exists', () => {
    const list = [conversation({ id: 'orig', isPlayback: true }), conversation({ id: 'other' })];
    expect(hasPlaybackConversation(list, 'orig')).toBe(true);
  });

  it('is false when the matching id has no playback row', () => {
    const list = [conversation({ id: 'orig', isPlayback: false })];
    expect(hasPlaybackConversation(list, 'orig')).toBe(false);
  });

  it('is false when the id is not present at all', () => {
    expect(hasPlaybackConversation([conversation({ id: 'other', isPlayback: true })], 'orig')).toBe(false);
  });
});

describe('isPinnedConversation', () => {
  it('is true only when isPinned is exactly true', () => {
    expect(isPinnedConversation(conversation({ isPinned: true }))).toBe(true);
    expect(isPinnedConversation(conversation({ isPinned: false }))).toBe(false);
    expect(isPinnedConversation(conversation())).toBe(false);
  });
});
