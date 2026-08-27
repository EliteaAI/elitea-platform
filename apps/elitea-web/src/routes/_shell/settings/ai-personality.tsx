/**
 * Settings: AI Personality route.
 *
 * Same shape as every other settings route here — read
 * `personalization.tsx` for the pattern. The page component itself is
 * `pages/settings/AIPersonality.tsx`.
 */
import { createFileRoute } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import type { SxProps, Theme } from '@mui/material/styles';

import { DrawerPageHeader } from '@/shared/ui/settings/DrawerPageHeader';
import { t } from '@/shared/i18n';
import { useSelectedProjectStore } from '@/widgets/app-shell';
import AIPersonality from '@/pages/settings/AIPersonality';

export const Route = createFileRoute('/_shell/settings/ai-personality')({
  component: SettingsAIPersonalityPage,
});

function SettingsAIPersonalityPage() {
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');

  return (
    <Paper elevation={0} sx={styles.root}>
      <DrawerPageHeader
        title={t('routes.settings.aipersonality.title', 'AI Personality')}
        showBorder
      />
      <Box sx={styles.content}>
        <AIPersonality projectId={projectId} />
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
