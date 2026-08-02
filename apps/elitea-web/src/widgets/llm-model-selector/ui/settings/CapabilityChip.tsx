import { memo } from 'react';

import { Chip, Tooltip } from '@mui/material';

interface CapabilityChipProps {
  type: 'vision' | 'reasoning';
  showTooltip?: boolean;
}

/** Small chip showing model capability (vision/reasoning). */
export const CapabilityChip = memo(({ type, showTooltip = false }: CapabilityChipProps) => {
  const label = type === 'vision' ? 'Vision' : 'Reasoning';
  const tooltip = type === 'vision' ? 'Model supports image input' : 'Model supports reasoning';

  return showTooltip ? (
    <Tooltip title={tooltip}>
      <Chip
        label={label}
        size="small"
        sx={{
          fontSize: '0.625rem',
          height: '1.25rem',
          bgcolor: 'action.hover',
          fontWeight: 500,
        }}
      />
    </Tooltip>
  ) : (
    <Chip
      label={label}
      size="small"
      sx={{
        fontSize: '0.625rem',
        height: '1.25rem',
        bgcolor: 'action.hover',
        fontWeight: 500,
      }}
    />
  );
});

CapabilityChip.displayName = 'CapabilityChip';
