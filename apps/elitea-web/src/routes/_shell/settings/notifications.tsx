/**
 * ROUTE-062 `/settings/notifications` — notification center settings page.
 *
 * Wires up the fully implemented `features/notifications` (list, bulk ops,
 * item rendering) to the settings route. Uses `NotificationListItem` from
 * `features/notifications/ui/NotificationListItem` and `useNotificationsList`
 * from `features/notifications/api/useNotifications`.
 */
import { useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { DrawerPageHeader } from '@/shared/ui/settings/DrawerPageHeader';
import { t } from '@/shared/i18n';
import { NotificationListItem } from '@/features/notifications/ui/NotificationListItem';
import {
  useBulkDeleteNotifications,
  useBulkMarkSeenNotifications,
  useNotificationsList,
} from '@/features/notifications/api/useNotifications';
import { useSelectedProjectStore } from '@/widgets/app-shell';

export const Route = createFileRoute('/_shell/settings/notifications')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: NotificationsPage,
});

function NotificationsPage() {
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [filterNew, setFilterNew] = useState(false);

  const { data, isFetching } = useNotificationsList(
    { projectId, params: { only_new: filterNew } },
    { enabled: !!projectId },
  );

  const bulkDelete = useBulkDeleteNotifications();
  const bulkMarkSeen = useBulkMarkSeenNotifications();

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const total = data?.total ?? 0;
  const styles = getStyles();

  const handleSelectAll = useCallback(() => {
    setSelectedIds((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }, [rows]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    bulkDelete.mutate({
      projectId,
      ids: Array.from(selectedIds),
    });
    setSelectedIds(new Set());
  }, [selectedIds, projectId, bulkDelete]);

  const handleMarkSeen = useCallback(
    (isSeen: boolean) => {
      if (selectedIds.size === 0) return;
      bulkMarkSeen.mutate({
        projectId,
        ids: Array.from(selectedIds),
        isSeen,
      });
      setSelectedIds(new Set());
    },
    [selectedIds, projectId, bulkMarkSeen],
  );

  if (!projectId) {
    return <RoutePending />;
  }

  return (
    <Paper elevation={0} sx={styles.root}>
      <DrawerPageHeader
        title={t('routes.settings.notifications.title', 'Notifications')}
        showSearchInput={false}
        showBorder
        slotProps={{
          addButton: {
            onAdd: handleSelectAll,
            tooltip: selectedIds.size === rows.length
              ? t('routes.settings.notifications.deselectAll', 'Deselect all')
              : t('routes.settings.notifications.selectAll', 'Select all'),
          },
        }}
        extraContent={
          <Box sx={styles.actions}>
            <Button
              disabled={selectedIds.size === 0}
              onClick={() => handleMarkSeen(true)}
            >
              {t('routes.settings.notifications.markRead', 'Mark read')}
            </Button>
            <Button
              color="error"
              disabled={selectedIds.size === 0}
              onClick={handleDeleteSelected}
            >
              {t('routes.settings.notifications.deleteSelected', 'Delete')}
            </Button>
            <Button onClick={() => setFilterNew((p) => !p)}>
              {filterNew
                ? t('routes.settings.notifications.showAll', 'Show all')
                : t('routes.settings.notifications.showNew', 'New only')}
            </Button>
          </Box>
        }
      />
      <Box sx={styles.content}>
        {isFetching && total === 0 ? (
          <Typography variant="bodyMedium" color="text.secondary">
            {t('routes.settings.notifications.loading', 'Loading notifications…')}
          </Typography>
        ) : rows.length === 0 ? (
          <Typography variant="bodyMedium" color="text.secondary">
            {t('routes.settings.notifications.empty', 'No notifications yet')}
          </Typography>
        ) : (
          rows.map((notification) => (
            <NotificationListItem
              key={notification.id}
              notification={notification}
              projectId={projectId}
              context="list"
            />
          ))
        )}
        {total > rows.length && (
          <Box sx={styles.pagination}>
            <Typography variant="bodySmall" color="text.secondary">
              {t('routes.settings.notifications.pagination', 'Showing {{count}} of {{total}}', {
                count: rows.length,
                total,
              })}
            </Typography>
          </Box>
        )}
      </Box>
    </Paper>
  );
}

const getStyles = (): {
  root: SxProps<Theme>;
  content: SxProps<Theme>;
  actions: SxProps<Theme>;
  pagination: SxProps<Theme>;
} => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    borderRadius: 'var(--el-shape-radiusSm, 0px)',
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: '1rem 1.5rem',
  },
  actions: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center',
  },
  pagination: {
    padding: '1rem 0 0',
    textAlign: 'center',
  },
});
