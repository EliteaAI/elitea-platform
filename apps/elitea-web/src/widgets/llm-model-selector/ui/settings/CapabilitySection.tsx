import { memo } from 'react';

import { Box } from '@mui/material';

import { CapabilityChip } from './CapabilityChip';

interface CapabilitySectionProps {
  supportsVision?: boolean;
  supportsReasoning?: boolean;
}

/** Display capabilities that a model supports. */
export const CapabilitySection = memo(({ supportsVision, supportsReasoning }: CapabilitySectionProps) => {
  const hasCapabilities = supportsVision || supportsReasoning;
  if (!hasCapabilities) return null;

  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {supportsVision && <CapabilityChip type="vision" showTooltip />}
      {supportsReasoning && <CapabilityChip type="reasoning" showTooltip />}
    </Box>
  );
});

CapabilitySection.displayName = 'CapabilitySection';
