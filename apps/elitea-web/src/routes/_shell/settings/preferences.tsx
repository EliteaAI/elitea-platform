/**
 * Settings: Preferences route.
 *
 * Same shape as every other settings route here — read
 * `personalization.tsx` for the pattern. The page component itself is
 * `pages/settings/Preferences.tsx`.
 */
import { createFileRoute } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import type { SxProps, Theme } from '@mui/material/styles';

import { DrawerPageHeader } from '@/shared/ui/settings/DrawerPageHeader';
import { t } from '@/shared/i18n';
import { useSelectedProjectStore } from '@/widgets/app-shell';
import Preferences from '@/pages/settings/Preferences';

export const Route = createFileRoute('/_shell/settings/preferences')({
  component: SettingsPreferencesPage,
});

function SettingsPreferencesPage() {
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');

  return (
    <Paper elevation={0} sx={styles.root}>
      <DrawerPageHeader
        title={t('routes.settings.preferences.title', 'Preferences')}
        showBorder
      />
      <Box sx={styles.content}>
        <Preferences projectId={projectId} />
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
