/**
 * features/notifications/ui/NotificationsListBody.tsx — the notification
 * list body: one of four branches, in this order — failed read, first load,
 * empty list, rows.
 *
 * It lived inside `routes/_shell/settings/notifications.tsx` as
 * `NotificationsListContent`. It moved here when the failed-read branch was
 * added (issue 413), because the route file then passed §3.5's 400-line
 * budget. The move is also the correct home: this is the notifications
 * feature's own UI, and it composes only that feature's parts
 * (`NotificationListItem`, `../lib/errorMessage`).
 */
import type { ReactElement } from 'react';

import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import type { NormalizedNotification } from '../api/normalize';
import { notificationErrorMessage } from '../lib/errorMessage';
import { NotificationListItem } from './NotificationListItem';

export interface NotificationsListBodyProps {
  readonly rows: readonly NormalizedNotification[];
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly total: number;
  readonly personalProjectId: string;
}

export function NotificationsListBody(props: NotificationsListBodyProps): ReactElement {
  const { rows, isFetching, isError, error, total, personalProjectId } = props;
  /**
   * The failed-read branch, and it MUST come first (issue 413).
   *
   * A failed list read leaves `data` undefined, so `rows` is empty and
   * `isFetching` settles false. Every failure therefore fell through to the
   * "No notifications yet" branch below and rendered as an empty inbox. That
   * is what hid the unregistered route: the screen looked healthy while
   * `GET /notifications/notifications/prompt_lib/{projectId}` answered 404 on
   * every OIDC-only deployment. Same swallowed-error class as issue 340 — an
   * empty result and a failed read must not look identical to the reader.
   */
  if (isError) {
    return (
      <Typography variant="bodyMedium" color="error" role="alert">
        {notificationErrorMessage(error)}
      </Typography>
    );
  }
  if (isFetching && total === 0) {
    return (
      <Typography variant="bodyMedium" color="text.secondary">
        {t('routes.settings.notifications.loading', 'Loading notifications…')}
      </Typography>
    );
  }
  if (rows.length === 0) {
    return (
      <Typography variant="bodyMedium" color="text.secondary">
        {t('routes.settings.notifications.empty', 'No notifications yet')}
      </Typography>
    );
  }
  return (
    <>
      {rows.map((notification) => (
        <NotificationListItem
          key={notification.id}
          notification={notification}
          projectId={personalProjectId}
          context="list"
        />
      ))}
    </>
  );
}
