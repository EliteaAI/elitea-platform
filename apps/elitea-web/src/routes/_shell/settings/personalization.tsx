/**
 * Settings: Personalization route — renders the user profile settings page.
 */
import { createFileRoute } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import type { SxProps, Theme } from '@mui/material/styles';

import { DrawerPageHeader } from '@/shared/ui/settings/DrawerPageHeader';
import { t } from '@/shared/i18n';
import { useSelectedProjectStore } from '@/widgets/app-shell';
import Personalization from '@/pages/settings/Personalization';

export const Route = createFileRoute('/_shell/settings/personalization')({
  component: SettingsPersonalizationPage,
});

function SettingsPersonalizationPage() {
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');

  return (
    <Paper elevation={0} sx={styles.root}>
      <DrawerPageHeader
        title={t('routes.settings.personalization.title', 'Personalization')}
        showBorder
      />
      <Box sx={styles.content}>
        <Personalization projectId={projectId} />
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
