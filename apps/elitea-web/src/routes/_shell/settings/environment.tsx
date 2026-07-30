/** ROUTE-054 `/settings/environment` — environment variable settings. */
import { createFileRoute } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import type { SxProps, Theme } from '@mui/material/styles';

import { DrawerPageHeader } from '@/shared/ui/settings/DrawerPageHeader';
import { EnvironmentSection } from '@/routes/_shell/settings/environment/EnvironmentSection';
import { t } from '@/shared/i18n';

export const Route = createFileRoute('/_shell/settings/environment')({
  component: EnvironmentSettingsPage,
});

function EnvironmentSettingsPage() {
  return (
    <Paper elevation={0} sx={styles.root}>
      <DrawerPageHeader
        title={t('routes.settings.environment.title', 'Environment')}
        showBorder
      />
      <Box sx={styles.content}>
        <EnvironmentSection />
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
    borderRadius: 0,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
};
