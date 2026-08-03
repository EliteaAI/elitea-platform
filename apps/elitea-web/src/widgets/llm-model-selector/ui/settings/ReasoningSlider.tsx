import { memo } from 'react';

import { Box, Slider, Typography } from '@mui/material';

interface ReasoningSliderProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const REASONING_LABELS = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
];

const REASONING_VALUE_MAP: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const REASONING_INVERSE: Record<number, string> = {
  0: 'low',
  1: 'medium',
  2: 'high',
};

/** Reasoning effort slider (Low/Medium/High). */
export const ReasoningSlider = memo(({ value, onChange, disabled }: ReasoningSliderProps) => {
  const numericValue = REASONING_VALUE_MAP[value] ?? 1;

  const handleChange = (_event: Event | React.SyntheticEvent, newValue: number | number[]) => {
    const num = (Array.isArray(newValue) ? newValue[0] : newValue) ?? 1;
    onChange(REASONING_INVERSE[num] ?? 'medium');
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2">Reasoning effort</Typography>
        <Typography variant="body2">
          {REASONING_LABELS.find((l) => l.value === value)?.label ?? 'Medium'}
        </Typography>
      </Box>
      <Slider
        value={numericValue}
        onChange={handleChange}
        disabled={disabled}
        min={0}
        max={2}
        step={1}
        marks={REASONING_LABELS.map((l) => ({ value: REASONING_VALUE_MAP[l.value] ?? 0, label: l.label }))}
        aria-label="Reasoning effort"
        sx={{
          '& .MuiSlider-thumb': { width: 16, height: 16 },
          '& .MuiSlider-track': { height: 4 },
          '& .MuiSlider-rail': { height: 4 },
        }}
      />
    </Box>
  );
});

ReasoningSlider.displayName = 'ReasoningSlider';
