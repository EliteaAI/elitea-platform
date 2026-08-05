/**
 * features/notifications/ui/NotificationListItem.tsx — port of
 * `apps/elitea-ui/src/[fsd]/entities/notifications/ui/
 * NotificationListItem.jsx` (unit A11).
 *
 * Two deliberate, disclosed signature deviations from the baseline, both
 * forced by what Wave 0/1 actually shipped (documented at the exact
 * relevant line, not just here):
 *  - `projectId` is a required PROP instead of an internal
 *    `useSelectedProjectId()` read. §2.3/R-S1/R-S2 remove the old app's
 *    global Redux store; there is no equivalent "selected project" accessor
 *    published from any layer this component may import (the only one that
 *    exists, `router-context.ts`'s `AuthContext.getSelectedProjectId()`, is
 *    `app/` layer, R-L1-forbidden from `features/`). The caller (a future
 *    widget/page) supplies it — the same shape `useNotificationsList`
 *    (`../api/useNotifications.ts`) already requires.
 *  - No `useToast()` call — see `../lib/errorMessage.ts`'s doc comment.
 *    `onMarkToggleError` is called with the built message string instead.
 */
import { useCallback, useState } from 'react';
import type { MouseEvent, ReactElement } from 'react';

import { formatDistanceToNow } from 'date-fns';

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { combineSx } from '@/shared/ui/lib/combineSx';
import { BUTTON_VARIANTS, BaseBtn } from '@/shared/ui/BaseBtn';
import { MarkReadIcon } from '@/shared/ui/icons/mark-read-icon';
import { MarkUnreadIcon } from '@/shared/ui/icons/mark-unread-icon';

import { shouldMarkAsRead as computeShouldMarkAsRead } from '@/entities/notification';

import type { NormalizedNotification } from '../api/normalize';
import { useBulkMarkSeenNotifications } from '../api/useNotifications';
import { notificationErrorMessage } from '../lib/errorMessage';
import { normalizeNotificationTimestamp } from '../lib/timestamp';
import { NotificationIcon } from './NotificationIcon';
import { NotificationMessage } from './NotificationMessage';

/** `notification` / `table` — `NOTIFICATION_CONTEXT_STYLES` (baseline). */
export type NotificationListItemContext = 'list' | 'table';

export interface NotificationListItemProps {
  readonly notification: NormalizedNotification;
  readonly projectId: string | undefined;
  readonly showTime?: boolean;
  readonly clampLines?: number;
  readonly showIcon?: boolean;
  readonly sx?: SxProps<Theme>;
  readonly contentSx?: SxProps<Theme>;
  readonly onNotificationSeenChange?: (id: string, isSeen: boolean) => void;
  readonly onCloseNotificationList?: (() => void) | undefined;
  readonly context?: NotificationListItemContext;
  readonly onMarkToggleError?: (message: string) => void;
}

const CONTEXT_TEXT_VARIANT: Record<NotificationListItemContext, 'bodySmall' | 'labelMedium'> = {
  list: 'bodySmall',
  table: 'labelMedium',
};

function itemStyles(clampLines: number, isContextList: boolean): Record<string, SxProps<Theme>> {
  return {
    container: (theme) => ({
      display: 'flex',
      padding: '0.5rem 0.75rem',
      alignItems: 'flex-start',
      height: 'auto',
      width: '100%',
      gap: '0.7rem',
      boxSizing: 'border-box',
      borderBottom: `0.0625rem solid ${theme.vars.palette.border.notificationItem}`,
      '&:hover': {
        backgroundColor: isContextList ? theme.vars.palette.background.tabButton.default : undefined,
      },
    }),
    markButton: {
      flexShrink: 0,
      alignSelf: 'center',
    },
    iconContainer: {
      width: '2rem',
      minWidth: '1rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      paddingTop: '0.0625rem',
      alignSelf: isContextList ? 'center' : 'flex-start',
      '& > svg': {
        width: '1.125rem',
        height: '1.125rem',
        display: 'block',
      },
    },
    content: {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
      overflow: 'hidden',
    },
    message: {
      overflow: 'hidden',
      ...(clampLines > 0
        ? {
            '& > *': {
              display: '-webkit-box',
              WebkitLineClamp: clampLines,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            },
          }
        : {}),
    },
  };
}

export function NotificationListItem(props: NotificationListItemProps): ReactElement {
  const {
    notification,
    projectId,
    showTime = true,
    clampLines = 3,
    showIcon = true,
    sx,
    contentSx,
    onNotificationSeenChange,
    onCloseNotificationList,
    context = 'list',
    onMarkToggleError,
  } = props;
  const theme = useTheme();
  const textVariant = CONTEXT_TEXT_VARIANT[context];
  const styles = itemStyles(clampLines, context === 'list');

  const [isHovered, setIsHovered] = useState(false);
  const bulkMarkSeen = useBulkMarkSeenNotifications();

  const notificationShouldMarkAsRead = computeShouldMarkAsRead(notification);
  const markToggleLabel = notificationShouldMarkAsRead
    ? t('notifications.listItem.markAsRead', 'Mark as read')
    : t('notifications.listItem.markAsUnread', 'Mark as unread');
  const MarkIcon = notificationShouldMarkAsRead ? MarkReadIcon : MarkUnreadIcon;

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  const handleMarkToggle = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      if (projectId === undefined) return;
      bulkMarkSeen.mutate(
        { projectId, ids: [notification.id], isSeen: notificationShouldMarkAsRead },
        {
          onSuccess: () => {
            onNotificationSeenChange?.(notification.id, notificationShouldMarkAsRead);
          },
          onError: (err) => {
            const message = notificationErrorMessage(err);
            if (onMarkToggleError) {
              onMarkToggleError(message);
            } else {
              // See ../lib/errorMessage.ts's doc comment: no toast system
              // exists yet for this component to surface into.
              console.error(message);
            }
          },
        },
      );
    },
    [projectId, notification.id, notificationShouldMarkAsRead, bulkMarkSeen, onNotificationSeenChange, onMarkToggleError],
  );

  return (
    <Box
      sx={combineSx(styles.container, sx)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {showIcon && (
        <Box sx={styles.iconContainer}>
          <NotificationIcon
            eventType={notification.eventType}
            meta={notification.meta}
            theme={theme}
          />
        </Box>
      )}
      <Box sx={combineSx(styles.content, contentSx)}>
        <Box sx={styles.message}>
          <NotificationMessage
            notification={notification}
            onCloseNotificationList={onCloseNotificationList}
            textVariant={textVariant}
          />
        </Box>
        {showTime && (
          <Typography variant="bodySmall">
            {t('notifications.listItem.timeAgo', '{{time}} ago', {
              time: formatDistanceToNow(new Date(normalizeNotificationTimestamp(notification.createdAt))),
            })}
          </Typography>
        )}
      </Box>
      {context === 'list' && isHovered && (
        <Tooltip
          title={markToggleLabel}
          enterDelay={1200}
          placement="top"
        >
          <BaseBtn
            variant={BUTTON_VARIANTS.secondary}
            startIcon={<MarkIcon />}
            aria-label={markToggleLabel}
            onClick={handleMarkToggle}
            sx={styles.markButton}
          />
        </Tooltip>
      )}
    </Box>
  );
}
