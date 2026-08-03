import { memo } from 'react';

import { Box, Slider, Typography } from '@mui/material';

import { DEFAULT_TEMPERATURE } from '@/shared/lib/constants';

interface CreativitySliderProps {
  temperature: number;
  onChange: (value: number) => void;
}

/** Temperature / creativity slider. */
export const CreativitySlider = memo(({ temperature, onChange }: CreativitySliderProps) => {
  const handleTemperatureChange = (_event: unknown, value: number | number[]) => {
    const num = (Array.isArray(value) ? value[0] : value) ?? DEFAULT_TEMPERATURE;
    onChange(num);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2">Temperature</Typography>
        <Typography variant="body2">{temperature?.toFixed(2)}</Typography>
      </Box>
      <Slider
        value={typeof temperature === 'number' ? temperature : DEFAULT_TEMPERATURE}
        onChange={handleTemperatureChange}
        min={0}
        max={2}
        step={0.01}
        aria-label="Temperature"
      />
    </Box>
  );
});

CreativitySlider.displayName = 'CreativitySlider';
