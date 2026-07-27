import type { Notification } from './types';

/**
 * apps/elitea-ui/src/[fsd]/widgets/Notifications/ui/NotificationListItem.jsx
 * :51-53 `shouldMarkAsRead = !notification.is_seen`.
 */
export function shouldMarkAsRead(notification: Notification): boolean {
  return !notification.isSeen;
}

/**
 * apps/elitea-ui/src/[fsd]/widgets/Notifications/ui/NotificationList.jsx:153
 * — enables the "mark all as read" action.
 */
export function hasUnreadNotifications(notifications: readonly Notification[]): boolean {
  return notifications.some((notification) => !notification.isSeen);
}

/**
 * apps/elitea-ui/src/[fsd]/widgets/Notifications/ui/NotificationTable.jsx:
 * 135-138 — whether any of the given selected ids point at an unread row.
 */
export function hasUnreadAmongSelected(notifications: readonly Notification[], selectedIds: ReadonlySet<string>): boolean {
  return notifications.some((notification) => selectedIds.has(notification.id) && !notification.isSeen);
}

/** Most-recent first — the server's default `sort_by=created_at, sort_order=desc`, ported for client-side re-sort. */
export function sortNotificationsByRecency(notifications: readonly Notification[]): Notification[] {
  return [...notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
