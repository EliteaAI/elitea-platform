/**
 * AI Personality page (settings tab) — replaces the old app's
 * `features/settings/ui/ai-personality/AIPersonality.jsx`.
 *
 * A thin shell: a header row plus the feature body. The fetch, the Formik
 * host, the `PUT /social/author` save and its toasts all live in the
 * feature's `SettingsFormProvider`, which Settings › Memory shares — the two
 * pages edit two halves of one author record.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { aiPersonalityFeature } from '@/features/settings';

const { AIPersonalityFormContent, SettingsFormProvider } = aiPersonalityFeature;

interface AIPersonalityProps {
  /** Currently-selected project id — threaded down from the route. */
  projectId?: string;
}

const AIPersonality = memo(({ projectId }: AIPersonalityProps) => (
  <Box sx={styles.container}>
    <Box sx={styles.header}>
      <Typography variant="labelMedium" color="text.secondary">
        {t('settings.aiPersonality', 'AI Personality')}
      </Typography>
    </Box>
    <Box sx={styles.content}>
      <SettingsFormProvider {...(projectId === undefined ? {} : { projectId })}>
        <AIPersonalityFormContent />
      </SettingsFormProvider>
    </Box>
  </Box>
));

AIPersonality.displayName = 'AIPersonality';

export default AIPersonality;

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
