/**
 * AIPersonalityFormContent — the body of Settings › AI Personality.
 *
 * Baseline: `EliteaUI/src/[fsd]/features/settings/ui/ai-personality/
 * AIPersonalityFormContent.jsx`. Owns the auto-save-on-blur wiring for the
 * page: the text field saves when it loses focus, the persona select saves
 * the moment it changes (`requestSubmit`).
 */
import Box from '@mui/material/Box';

import { useFormikAutoSaveOnBlur } from '@/shared/lib/hooks/useFormikAutoSaveOnBlur';

import { AIPersonalityPersonalization } from './AIPersonalityPersonalization';

export function AIPersonalityFormContent() {
  const { onBlur, requestSubmit } = useFormikAutoSaveOnBlur();

  return (
    <Box sx={styles.wrapper} onBlur={onBlur}>
      <Box sx={styles.container} data-testid="ai-personality-form-content">
        <AIPersonalityPersonalization onAutoSaveRequested={requestSubmit} />
      </Box>
    </Box>
  );
}

const styles = {
  wrapper: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
  },
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '1.5rem',
    maxWidth: '50rem',
    width: '100%',
  },
};
