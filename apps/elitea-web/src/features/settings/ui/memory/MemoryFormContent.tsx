/**
 * MemoryFormContent — the body of Settings › Memory.
 *
 * Baseline: `EliteaUI/src/[fsd]/features/settings/ui/memory/
 * MemoryFormContent.jsx`. Owns the page's auto-save wiring: the numeric and
 * text fields save when they lose focus, the toggles save on change.
 */
import Box from '@mui/material/Box';

import { useFormikAutoSaveOnBlur } from '@/shared/lib/hooks/useFormikAutoSaveOnBlur';

import { MemoryContextManagement } from './MemoryContextManagement';

export function MemoryFormContent() {
  const { onBlur, requestSubmit } = useFormikAutoSaveOnBlur();

  return (
    <Box sx={styles.wrapper} onBlur={onBlur}>
      <Box sx={styles.container} data-testid="memory-form-content">
        <MemoryContextManagement onAutoSaveRequested={requestSubmit} />
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
