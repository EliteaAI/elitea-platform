/**
 * Memory page (settings tab) — replaces the old app's
 * `features/settings/ui/memory/Memory.jsx`.
 *
 * A thin shell: a header row plus the feature body. Shares one save
 * mechanism with Settings › AI Personality (`SettingsFormProvider`) because
 * both pages edit the same author record and save it with the same
 * `PUT /social/author`.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { aiPersonalityFeature, memoryFeature } from '@/features/settings';

const { SettingsFormProvider } = aiPersonalityFeature;
const { MemoryFormContent } = memoryFeature;

export interface MemoryProps {
  /** Currently-selected project id — threaded down from the route. */
  projectId?: string;
}

const Memory = memo(({ projectId }: MemoryProps) => (
  <Box sx={styles.container}>
    <Box sx={styles.header}>
      <Typography variant="labelMedium" color="text.secondary">
        {t('settings.memory', 'Memory')}
      </Typography>
    </Box>
    <Box sx={styles.content}>
      <SettingsFormProvider {...(projectId === undefined ? {} : { projectId })}>
        <MemoryFormContent />
      </SettingsFormProvider>
    </Box>
  </Box>
));

Memory.displayName = 'Memory';

export default Memory;

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
  },
  header: {
    height: '3.75rem',
    minHeight: '3.75rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 1.5rem',
    borderBottom: '0.0625rem solid',
    borderColor: 'border.table',
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
};
