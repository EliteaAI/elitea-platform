/**
 * Preferences page (settings tab) — replaces the old app's
 * `features/settings/ui/preference/Preferences.jsx`.
 *
 * A thin page shell only: a header row plus the feature body. Every control
 * on this page persists itself (theme mode via `useColorScheme`, voice and
 * sound config via `localStorage`), so there is no fetch, no form and no
 * save bar here — unlike the sibling `Personalization.tsx`.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { preferencesFeature } from '@/features/settings';

const { PreferencesFormContent } = preferencesFeature;

interface PreferencesProps {
  /** Currently-selected project id — threaded down from the route. */
  projectId: string;
}

const Preferences = memo(({ projectId }: PreferencesProps) => (
  <Box sx={styles.container}>
    <Box sx={styles.header}>
      <Typography variant="labelMedium" color="text.secondary" sx={styles.title}>
        {t('settings.preferences', 'Preferences')}
      </Typography>
    </Box>
    <Box sx={styles.content}>
      <PreferencesFormContent projectId={projectId} />
    </Box>
  </Box>
));

Preferences.displayName = 'Preferences';

export default Preferences;

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
  title: {
    fontWeight: 600,
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
};
