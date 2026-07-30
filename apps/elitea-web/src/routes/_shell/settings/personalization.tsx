/**
 * Settings: Personalization route — renders the user profile settings page.
 */
import { createFileRoute } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import type { SxProps, Theme } from '@mui/material/styles';

import { DrawerPageHeader } from '@/shared/ui/settings/DrawerPageHeader';
import { t } from '@/shared/i18n';
import ProfilePage from '@/routes/_shell/settings/profile/ProfilePage';

export const Route = createFileRoute('/_shell/settings/personalization')({
  component: SettingsPersonalizationPage,
});

function SettingsPersonalizationPage() {
  return (
    <Paper elevation={0} sx={styles.root}>
      <DrawerPageHeader
        title={t('routes.settings.personalization.title', 'Personalization')}
        showBorder
      />
      <Box sx={styles.content}>
        <ProfilePage />
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
