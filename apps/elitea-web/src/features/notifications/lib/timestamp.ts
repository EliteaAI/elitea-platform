/**
 * features/notifications/lib/timestamp.ts — port of
 * `apps/elitea-ui/src/common/convertChatConversationMessages.js:21-33`'s
 * `convertTime`, consumed by `NotificationListItem.jsx:105`
 * (`formatDistanceToNow(new Date(convertTime(notification.created_at)))`).
 *
 * Not available from `shared/lib` (chat's C-series units, which own the
 * rest of that source file, have not landed) — duplicated locally as a
 * self-contained ~10-line function rather than reached for across the
 * ownership fence. Flagged for consolidation once a chat unit lands the
 * same helper in `shared/lib`.
 *
 * Normalizes a backend timestamp that may be missing an explicit UTC
 * marker into one `new Date(...)` parses as UTC rather than local time —
 * `"2026-01-01 12:00:00"` (space-separated, naive) becomes
 * `"2026-01-01T12:00:00Z"`; a string already carrying `Z` or a `+offset`
 * is returned unchanged.
 */
export function normalizeNotificationTimestamp(time: string): string {
  const timeStrings = time.split(' ');
  if (timeStrings.length > 1) {
    return `${timeStrings[0]}T${timeStrings[1]}Z`;
  }
  if (time.at(-1) === 'Z') {
    return time;
  }
  if (time.includes('+')) {
    return time;
  }
  return `${time}Z`;
}
