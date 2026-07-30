/** ROUTE-056 `/settings/prompts` — service prompts configuration. */
import { createFileRoute } from '@tanstack/react-router';

import Paper from '@mui/material/Paper';
import type { SxProps, Theme } from '@mui/material/styles';

import { ServicePromptsSection } from '@/routes/_shell/settings/system-prompts/ServicePromptsSection';

export const Route = createFileRoute('/_shell/settings/prompts')({
  component: ServicePromptsPage,
});

function ServicePromptsPage() {
  return (
    <Paper elevation={0} sx={styles.root}>
      <ServicePromptsSection />
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
};
