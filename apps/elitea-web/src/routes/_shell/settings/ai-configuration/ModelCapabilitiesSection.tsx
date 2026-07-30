/**
 * ModelCapabilitiesSection — displays capability chips for a model.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/Configuration/ModelCapabilitiesSection.jsx`.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/ui/lib/t';

export interface ModelCapabilitiesSectionProps {
  capabilities: readonly string[];
}

export default memo(function ModelCapabilitiesSection({ capabilities }: ModelCapabilitiesSectionProps) {
  const styles = modelCapabilitiesSectionStyles();

  if (!capabilities || capabilities.length === 0) {
    return null;
  }

  return (
    <Box sx={styles.capabilitiesSection}>
      <Typography variant="h6" sx={styles.sectionTitle}>
        {t('ai-configuration.modelCapabilities.title', 'Model Capabilities')}
      </Typography>
      <Box sx={styles.capabilitiesContainer}>
        {capabilities.map((capability, index) => (
          <Chip key={index} label={capability} size="small" sx={styles.capabilityChip} />
        ))}
      </Box>
    </Box>
  );
});

function modelCapabilitiesSectionStyles() {
  return {
    capabilitiesSection: { flexShrink: 0 },
    sectionTitle: {
      color: '#9ca3af',
      fontWeight: 600,
      fontSize: '1rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
    },
    capabilitiesContainer: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' },
    capabilityChip: {
      backgroundColor: '#1976d2',
      color: '#ffffff',
      fontWeight: 500,
      fontSize: '0.75rem',
      height: '1.75rem',
      borderRadius: '0.875rem',
      border: 'none',
      '&:hover': { backgroundColor: '#115293' },
    },
  };
}
