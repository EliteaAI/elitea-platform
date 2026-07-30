/**
 * FieldWithCopy — displays a labeled field with a copy-to-clipboard icon.
 * Used in ProjectAIConfiguration.
 */
import { memo, useCallback } from 'react';

import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

export interface FieldWithCopyProps {
  label: string;
  value: string;
}

export default memo(function FieldWithCopy({ label, value }: FieldWithCopyProps) {
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Silently fail
    }
  }, [value]);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <Typography
        variant="bodySmall"
        color="text.secondary"
        sx={{ flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Typography
        variant="bodySmall"
        color="text.primary"
        sx={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {value}
      </Typography>
      <Tooltip title="Copy">
        <IconButton size="small" onClick={handleCopy}>
          <ContentCopyIcon fontSize="small" sx={{ fontSize: '0.875rem' }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
});
