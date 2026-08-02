// @ts-nocheck — strict TS refinements pending
import { memo } from 'react';

import { Box, TextField, Typography } from '@mui/material';

import { DEFAULT_STEPS_LIMIT } from '@/shared/lib/constants';

interface StepsLimitInputProps {
  value: number;
  onChange: (value: number) => void;
}

/** Steps limit numeric input. */
export const StepsLimitInput = memo(({ value, onChange }: StepsLimitInputProps) => {
  return (
    <Box>
      <Typography
        variant="body2"
        sx={{ mb: 0.5 }}
      >
        Steps limit
      </Typography>
      <TextField
        type="number"
        value={value ?? DEFAULT_STEPS_LIMIT}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || DEFAULT_STEPS_LIMIT)}
        size="small"
        inputProps={{ min: 1, max: 100 }}
        sx={{ width: '100%' }}
      />
    </Box>
  );
});

StepsLimitInput.displayName = 'StepsLimitInput';
