/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { Notification, NotificationEventType, NotificationMeta, NotificationPage } from './model/types';
export {
  hasUnreadAmongSelected,
  hasUnreadNotifications,
  shouldMarkAsRead,
  sortNotificationsByRecency,
} from './model/selectors';
