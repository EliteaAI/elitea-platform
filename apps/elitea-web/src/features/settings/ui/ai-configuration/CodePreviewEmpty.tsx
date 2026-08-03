/**
 * CodePreviewEmpty — displays when no model is selected.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/OpenAITemplate/CodePreviewEmpty.jsx`.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/ui/lib/t';

export default memo(function CodePreviewEmpty() {
  const styles = getStyles();

  return (
    <Box sx={styles.emptyStateContainer}>
      <Box>
        <Typography variant="bodyMedium" color="text.secondary" sx={styles.emptyStateTitle}>
          {t('ai-configuration.codePreview.empty.title', 'Select a LLM Model to see Code examples')}
        </Typography>
        <Box sx={styles.emptyStateSubtitleContainer}>
          <Typography variant="bodySmall" color="text.disabled" sx={styles.emptyStateSubtitle}>
            {t('ai-configuration.codePreview.empty.subtitle', 'Choose from the LLM Model dropdown list.')}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
});

function getStyles() {
  return {
    emptyStateContainer: {
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2.5rem 1.25rem',
      textAlign: 'center',
    },
    emptyStateTitle: { marginBottom: '1rem' },
    emptyStateSubtitleContainer: { marginTop: '1rem' },
    emptyStateSubtitle: { lineHeight: 1.8, display: 'block', whiteSpace: 'normal' },
  };
}
