import { describe, expect, it } from 'vitest';

import { hasUnreadAmongSelected, hasUnreadNotifications, shouldMarkAsRead, sortNotificationsByRecency } from './selectors';
import type { Notification } from './types';

const notification = (id: string, isSeen: boolean, createdAt = '2026-01-01T00:00:00Z'): Notification => ({
  id,
  eventType: 'chat_user_added',
  isSeen,
  createdAt,
});

describe('shouldMarkAsRead', () => {
  it('is true for an unread notification', () => {
    expect(shouldMarkAsRead(notification('1', false))).toBe(true);
  });

  it('is false for an already-read notification', () => {
    expect(shouldMarkAsRead(notification('1', true))).toBe(false);
  });
});

describe('hasUnreadNotifications', () => {
  it('is true when at least one is unread', () => {
    expect(hasUnreadNotifications([notification('1', true), notification('2', false)])).toBe(true);
  });

  it('is false when every notification is read', () => {
    expect(hasUnreadNotifications([notification('1', true), notification('2', true)])).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(hasUnreadNotifications([])).toBe(false);
  });
});

describe('hasUnreadAmongSelected', () => {
  const notifications = [notification('1', false), notification('2', true), notification('3', false)];

  it('is true when a selected id is unread', () => {
    expect(hasUnreadAmongSelected(notifications, new Set(['2', '3']))).toBe(true);
  });

  it('is false when every selected id is read', () => {
    expect(hasUnreadAmongSelected(notifications, new Set(['2']))).toBe(false);
  });

  it('is false when the selection is empty', () => {
    expect(hasUnreadAmongSelected(notifications, new Set())).toBe(false);
  });
});

describe('sortNotificationsByRecency', () => {
  it('orders most-recent first', () => {
    const older = notification('1', true, '2026-01-01T00:00:00Z');
    const newer = notification('2', true, '2026-01-05T00:00:00Z');
    expect(sortNotificationsByRecency([older, newer]).map((n) => n.id)).toEqual(['2', '1']);
  });

  it('does not mutate the input', () => {
    const list = [notification('1', true), notification('2', true, '2026-02-01T00:00:00Z')];
    const copy = [...list];
    sortNotificationsByRecency(list);
    expect(list).toEqual(copy);
  });
});
