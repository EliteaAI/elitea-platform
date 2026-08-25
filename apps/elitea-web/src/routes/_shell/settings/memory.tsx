/**
 * Settings: Memory route.
 *
 * Same shape as every other settings route here — read
 * `personalization.tsx` for the pattern. The page component itself is
 * `pages/settings/Memory.tsx`.
 */
import { createFileRoute } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import type { SxProps, Theme } from '@mui/material/styles';

import { DrawerPageHeader } from '@/shared/ui/settings/DrawerPageHeader';
import { t } from '@/shared/i18n';
import { useSelectedProjectStore } from '@/widgets/app-shell';
import Memory from '@/pages/settings/Memory';

export const Route = createFileRoute('/_shell/settings/memory')({
  component: SettingsMemoryPage,
});

function SettingsMemoryPage() {
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');

  return (
    <Paper elevation={0} sx={styles.root}>
      <DrawerPageHeader
        title={t('routes.settings.memory.title', 'Memory')}
        showBorder
      />
      <Box sx={styles.content}>
        <Memory projectId={projectId} />
      </Box>
    </Paper>
  );
}

const styles: Record<string, SxProps<Theme>> = {
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
  },
};
