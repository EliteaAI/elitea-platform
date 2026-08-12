import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { useNavigate, useRouteContext } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import type { Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';

import {
  NotificationListItem,
  useBulkMarkSeenNotifications,
  useNotificationsSSE,
  useNotificationsList,
} from '@/features/notifications';
import { t } from '@/shared/i18n';
import { BUTTON_VARIANTS, BaseBtn } from '@/shared/ui/BaseBtn';

/**
 * SHELL-013 (disclosed composition gap) — the header-bell notification
 * popover. Old app: `[fsd]/widgets/sidebar-root/ui/button/
 * NotificationButton.jsx` (trigger + unread badge + live socket push) and
 * `[fsd]/widgets/Notifications/ui/NotificationList.jsx` (the popover
 * content — NOT ported directly; this widget reuses `features/
 * notifications`'s already-built `NotificationListItem` with
 * `context="list"` instead, per this unit's task brief).
 *
 * **Icon choice:** `@mui/icons-material`'s `NotificationsNoneOutlined`
 * substitutes for the old app's hand-rolled `components/Icons/BellIcon.jsx`
 * — the SAME documented-substitution precedent `SidebarBody.tsx` already
 * established in this exact file tree (`ChatBubbleOutlineIcon` standing in
 * for `ChatIcon.jsx`), chosen over porting a local inline SVG (the
 * alternative precedent, `features/notifications/ui/NotificationIcon.tsx`'s
 * `HeartIcon`/`CommentIcon`/`MedalIcon`) because this file already sits in a
 * widget that leans on `@mui/icons-material` for exactly this situation.
 * The unread indicator is a MANUALLY POSITIONED dot `Box` (matching
 * `SidebarConnectionDot.tsx`'s own absolute-positioned dot, not MUI's
 * `<Badge>`) because `<Badge variant="dot">`'s only styling hook is the
 * `.MuiBadge-dot` internal selector, which `elitea/no-mui-internal-selector`
 * (R-T6) bans outside `shared/brand/mui-overrides/` — a manual dot avoids
 * that fence entirely and reuses a real in-app precedent instead of a new
 * one. Colour is `theme.vars.palette.icon.fill.error` (a real brand token,
 * same token `SidebarConnectionDot`'s disconnected state already uses —
 * never the old app's raw `'#D71616'`).
 *
 * **Personal-project scoping:** notifications are scoped to
 * `personal_project_id`, matching the rest of this Wave-2 unit
 * (`routes/_shell/settings/notifications.tsx`, `routes/_shell/settings/
 * tokens.tsx`). Neither route may be imported from a widget (R-L1), so the
 * small `PersonalProjectIdContext`/`isPersonalProjectIdContext`/
 * `selectPersonalProjectId` trio below is a duplicate of the identical
 * shim those two files each already carry independently — this codebase's
 * established convention for a seam with no shared accessor and near-zero
 * reuse value (documented at each of those two call sites).
 *
 * **Live push is SSE, not socket.io (issue #92):** the old app's
 * `useSocket(sioEvents.notifications_notify, ...)` subscription is gone;
 * `features/notifications`'s `useNotificationsSSE` subscribes to the Go
 * route `GET {vite_server_url}/notifications/events/prompt_lib/
 * {projectId}` instead (`services/elitea-main/internal/api/v2/
 * notifications/events.go`). Socket.io is permanently dead in the
 * E2E compose stack (`VITE_SOCKET_SERVER=""`), so the socket path could
 * never fire there at all. One behavioural difference, deliberate: the
 * socket subscription was unconditional, while the SSE stream is scoped to
 * `personal_project_id` — the server route takes the project id in its
 * path and authorizes against it, so there is no unscoped stream to open.
 *
 * **Graceful degradation:** no personal project id, no runtime config, or
 * a runtime with no `EventSource` at all ⇒ the hook no-ops and the widget
 * still renders fully. The on-mount/refetch-driven badge keeps working;
 * only the "flip on immediately from a live push" half is unavailable —
 * the same degradation shape the socket version had with no provider
 * mounted.
 *
 * **Graceful degradation, no personal project:** matches the old app's own
 * `onClickNotificationButton` exactly — `navigate(RouteDefinitions.Chat)`
 * instead of opening the popover when `personal_project_id` is unset. This
 * app's equivalent route is `/chat` (`widgets/sidebar/lib/navSections.ts`).
 *
 * **Mount point — a disclosed correction, not a silent one:** this unit's
 * task brief describes the old app's relative position as "just above the
 * Settings/Help-Center footer buttons." That is NOT what
 * `SidebarBody.jsx:233` actually shows: `{!sideBarCollapsed &&
 * <Buttons.NotificationButton />}` sits inside `styles.header`, the STICKY
 * TOP row, as the second child right after the logo/toggle `IconButton` —
 * nowhere near the footer. (Corroborating evidence in THIS app:
 * `SidebarHeader.tsx`'s own header `Box` is already laid out with
 * `justifyContent: collapsed ? 'center' : 'space-between'` around a SINGLE
 * child, which only makes layout sense if a second child was always meant
 * to sit there.) This unit's file scope is `NotificationButton.tsx` (+
 * test) and `SidebarBody.tsx` (+ its test) only — not `SidebarHeader.tsx` —
 * so per the task brief's own "use your own judgment... but stay within
 * scope" instruction, this widget is mounted in `SidebarBody.tsx` exactly
 * where the brief directs (directly before `<SidebarFooter>`, gated on
 * `!collapsed`), with this comment as the disclosed record of the more
 * accurate old-app position for whoever next revisits the sidebar header.
 * See `SidebarBody.tsx`'s own doc comment for the mount-point wiring.
 */
interface PersonalProjectIdContext {
  readonly auth?: {
    readonly getUser?: () => { readonly personal_project_id?: string } | undefined;
  };
}

function isPersonalProjectIdContext(value: unknown): value is PersonalProjectIdContext {
  return typeof value === 'object' && value !== null;
}

function selectPersonalProjectId(context: unknown): string | undefined {
  if (!isPersonalProjectIdContext(context)) return undefined;
  return context.auth?.getUser?.()?.personal_project_id;
}

/** Old app: `NotificationList.jsx`'s `POPOVER_PAGE_SIZE = 5`. */
const POPOVER_PAGE_SIZE = 5;

export function NotificationButton(): ReactNode {
  const navigate = useNavigate();
  const routeContext: unknown = useRouteContext({ strict: false });
  const personalProjectId = selectPersonalProjectId(routeContext);

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [hasUnread, setHasUnread] = useState(false);

  // Badge-only signal: the real API has no dedicated "count only" param
  // (`features/notifications/api/notifications.ts`'s `ListNotificationsParams`
  // — see that file's header), so `pageSize: 1` + `only_new: true` (both
  // real, already-supported params) plus reading the response's own `total`
  // field is the faithful equivalent of the old app's
  // `only_new: true, only_total: true, pageSize: 1` query shape.
  const { data, dataUpdatedAt } = useNotificationsList(
    { projectId: personalProjectId ?? '', pageSize: 1, params: { only_new: true } },
    { enabled: !!personalProjectId },
  );

  // Old app: `useEffect(() => { if (data !== undefined) setHasMessages(!!data
  // ?.total); }, [data])` (`NotificationButton.jsx:60-64`) — every fresh
  // query response is AUTHORITATIVE and can flip the dot back off (e.g.
  // after "mark all as read" invalidates and refetches this same query,
  // `features/notifications/api/useNotifications.ts`'s
  // `NOTIFICATIONS_QUERY_ROOT` invalidation). The live-push handler below
  // only ever sets this `true` OPTIMISTICALLY between refetches — reproduced
  // as-is, not `pushedUnread || data-derived` (that OR'd shape is a one-way
  // ratchet: once a live push flips it `true`, no later "actually 0 now"
  // response could ever flip it back).
  //
  // `dataUpdatedAt` (also in the deps, alongside `data` itself) matters:
  // TanStack Query's default `structuralSharing` keeps `data`'s object
  // reference stable across a refetch that resolves to an unchanged value
  // (e.g. `{ rows: [], total: 0 }` again, right after a push already set
  // this optimistically `true`) — RTK Query, the old app's client, has no
  // such structural-sharing reuse and hands back a fresh reference on every
  // fetch. Depending on `data` alone would silently reintroduce the exact
  // one-way-ratchet bug this fix exists to close, in the very common case
  // where the "authoritative" refetch confirms the same total the previous
  // fetch already had. `dataUpdatedAt` changes on every settle regardless.
  useEffect(() => {
    if (data !== undefined) setHasUnread(!!data.total);
  }, [data, dataUpdatedAt]);

  // Live push, now over SSE (issue #92 — see this file's header). No-ops
  // without a personal project id, without runtime config, or in a runtime
  // with no `EventSource`; `notifications_ready` inside the hook also
  // invalidates the list query, so the effect above re-runs authoritatively.
  const handleNotify = useCallback(() => setHasUnread(true), []);
  useNotificationsSSE(personalProjectId, handleNotify);

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (!personalProjectId) {
        void navigate({ to: '/chat' });
        return;
      }
      setAnchorEl(event.currentTarget);
    },
    [navigate, personalProjectId],
  );

  const handleClose = useCallback(() => setAnchorEl(null), []);

  return (
    <>
      <Tooltip
        title={t('widgets.sidebar.notification.tooltip', 'Notifications')}
        placement="right"
      >
        <IconButton
          data-testid="sidebar-notification-button"
          aria-label={t('widgets.sidebar.notification.tooltip', 'Notifications')}
          onClick={handleClick}
          sx={(theme: Theme) => ({
            position: 'relative',
            width: '2rem',
            height: '2rem',
            '&:hover': { backgroundColor: theme.vars.palette.background.button.tertiary.hover },
            '&:active': { backgroundColor: theme.vars.palette.background.button.tertiary.pressed },
          })}
        >
          <NotificationsNoneOutlined sx={{ width: '1rem', height: '1rem' }} />
          {hasUnread && (
            <Box
              data-testid="sidebar-notification-unread-dot"
              sx={(theme: Theme) => ({
                position: 'absolute',
                top: '0.375rem',
                right: '0.375rem',
                width: '0.5rem',
                height: '0.5rem',
                borderRadius: theme.vars.shape.radiusPill,
                backgroundColor: theme.vars.palette.icon.fill.error,
              })}
            />
          )}
        </IconButton>
      </Tooltip>
      {anchorEl && personalProjectId && (
        <Popover
          open
          anchorEl={anchorEl}
          onClose={handleClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{
            paper: { sx: (theme: Theme) => ({ borderRadius: theme.vars.shape.radiusMd, overflow: 'hidden' }) },
          }}
        >
          <NotificationPopoverContent
            projectId={personalProjectId}
            onClose={handleClose}
          />
        </Popover>
      )}
    </>
  );
}

interface NotificationPopoverContentProps {
  readonly projectId: string;
  readonly onClose: () => void;
}

/** The popover body: header + up to 5 most-recent-unread rows + mark-all/view-all. Split out to keep `NotificationButton`'s own prop/effect counts minimal (§3.5). */
function NotificationPopoverContent({ projectId, onClose }: NotificationPopoverContentProps): ReactNode {
  const navigate = useNavigate();
  const { data, isFetching } = useNotificationsList({
    projectId,
    pageSize: POPOVER_PAGE_SIZE,
    params: { only_new: true },
  });
  const bulkMarkSeen = useBulkMarkSeenNotifications();
  const rows = data?.rows ?? [];
  const hasUnreadRow = rows.some((row) => !row.isSeen);

  const handleMarkAllAsRead = useCallback(() => {
    bulkMarkSeen.mutate({ projectId, ids: 'all', isSeen: true });
  }, [projectId, bulkMarkSeen]);

  const handleViewAll = useCallback(() => {
    void navigate({ to: '/settings/notifications' });
    onClose();
  }, [navigate, onClose]);

  return (
    <Box
      sx={(theme: Theme) => ({
        background: theme.vars.palette.background.notificationList,
        width: '20rem',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      })}
    >
      <Box
        sx={(theme: Theme) => ({
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1.25rem',
          borderBottom: `0.0625rem solid ${theme.vars.palette.border.notificationItem}`,
        })}
      >
        <Typography
          variant="labelMedium"
          color="text.secondary"
        >
          {t('widgets.sidebar.notification.title', 'Notifications')}
        </Typography>
        <IconButton
          size="small"
          aria-label={t('widgets.sidebar.notification.close', 'Close notifications')}
          onClick={onClose}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box>
        {rows.map((notification) => (
          <NotificationListItem
            key={notification.id}
            notification={notification}
            projectId={projectId}
            context="list"
            onCloseNotificationList={onClose}
          />
        ))}
        {rows.length === 0 && (
          <Box sx={{ padding: '0.75rem 1.25rem' }}>
            <Typography
              variant="bodySmall"
              color="text.secondary"
            >
              {isFetching
                ? t('widgets.sidebar.notification.loading', 'Loading…')
                : t('widgets.sidebar.notification.empty', 'No new notifications right now')}
            </Typography>
          </Box>
        )}
      </Box>

      {rows.length > 0 && (
        <BaseBtn
          variant={BUTTON_VARIANTS.auxiliary}
          onClick={handleMarkAllAsRead}
          disabled={!hasUnreadRow}
          // `borderRadius: 0` (old app's own override here) dropped —
          // R-T10 bans ad-hoc radius even for the zero value; same
          // documented drop as `RunStateNodeGroup.tsx`.
          sx={(theme: Theme) => ({ borderTop: `0.0625rem solid ${theme.vars.palette.border.notificationItem}` })}
        >
          {t('widgets.sidebar.notification.markAllRead', 'Mark all as read')}
        </BaseBtn>
      )}
      <BaseBtn
        variant={BUTTON_VARIANTS.auxiliary}
        onClick={handleViewAll}
        sx={(theme: Theme) => ({ borderTop: `0.0625rem solid ${theme.vars.palette.border.notificationItem}` })}
      >
        {t('widgets.sidebar.notification.viewAll', 'View all')}
      </BaseBtn>
    </Box>
  );
}
