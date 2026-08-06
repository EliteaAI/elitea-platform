/**
 * `useNotificationsSSE` — the notifications half of the socket.io → SSE
 * migration (issue #92). Replaces the `notifications_notify` socket.io
 * subscription `widgets/sidebar/ui/NotificationButton.tsx` used to carry.
 *
 * Server contract (`services/elitea-main/internal/api/v2/notifications/
 * current_events.go`):
 *   GET {vite_server_url}/notifications/events/prompt_lib/{projectId}
 *   - `notifications_ready` — the stream's opening cursor handshake, and
 *     also what the server sends INSTEAD of a notification whose metadata
 *     is too large for the stream contract ("the durable list remains
 *     authoritative for oversized metadata"). Both cases mean the same
 *     thing to this client: the durable list is ahead of the cache, so
 *     invalidate and let TanStack Query refetch it.
 *   - `notifications_notify` — one new notification. Optimistic signal
 *     only: it flips the caller's unread indicator on immediately, and the
 *     next authoritative list response is still free to flip it back off
 *     (see NotificationButton.tsx's own note on the one-way-ratchet bug).
 *   - `: heartbeat` comments every 15s — invisible to `EventSource`
 *     consumers by design, no handler needed.
 *
 * Auth is the session cookie (`withCredentials`, see `shared/api/sse`), and
 * the Go route's permission check is `models.notifications.notifications.
 * list` resolved against the SAME project id the list query uses.
 *
 * Graceful degradation (§3.6): no project id, or a runtime config that
 * failed to resolve, yields a `null` url and `useEventSource` no-ops. The
 * badge keeps working off the mount/refetch-driven list query — only the
 * live-push half is unavailable, which is exactly the degradation shape the
 * socket version had when no provider was mounted.
 */
import { useMemo } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { useEventSource } from '@/shared/api/sse';
import { getConfig } from '@/shared/config';

import { NOTIFICATIONS_QUERY_ROOT } from '../api/useNotifications';

export function useNotificationsSSE(projectId: string | undefined, onNotify: () => void): void {
  const queryClient = useQueryClient();
  const config = getConfig();
  const serverUrl = config.status === 'ok' ? config.config.vite_server_url : null;

  const url = useMemo(
    () => (projectId && serverUrl ? `${serverUrl}/notifications/events/prompt_lib/${projectId}` : null),
    [projectId, serverUrl],
  );

  useEventSource(
    url,
    {
      notifications_notify: () => onNotify(),
      notifications_ready: () => {
        void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_ROOT });
      },
    },
    {
      /**
       * A failed stream is TERMINAL: `EventSource` retries only after a
       * clean end, never after an HTTP status. The Go route answers 429
       * (`Retry-After: 2`) once its per-principal cap of 4 concurrent
       * streams is saturated — `newCurrentNotificationAdmission(64, 4)` in
       * `current_events.go` — plus 403 on authorize failure and 503 when
       * the reader is down. Without this the badge would silently stop
       * updating live with nothing in the console to explain it.
       *
       * Deliberately a warn and nothing more: the unread dot is still
       * driven by the on-mount/refetch list query (see
       * `NotificationButton.tsx`), so losing the stream degrades to the
       * pre-#92 polling behaviour rather than breaking the surface. A
       * bounded re-open policy belongs with whoever sizes that admission
       * cap for real tab counts — inventing one here would just hammer a
       * server that is already saying "too many".
       */
      onError: () => {
        // eslint-disable-next-line no-console -- same contract as shared/api/socket/client.ts: warn, never throw or silently drop
        console.warn('notifications SSE stream failed; live push is off until this component remounts (the list query still polls)');
      },
    },
  );
}
