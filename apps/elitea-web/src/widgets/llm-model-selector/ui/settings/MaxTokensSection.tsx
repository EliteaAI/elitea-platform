import { memo, useCallback, useEffect, useState, type ChangeEvent } from 'react';

import { Box, IconButton, InputAdornment, TextField, Typography } from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';

import { DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS_CUSTOM } from '@/shared/lib/constants';
import { RadioButtonGroup } from '@/shared/ui/RadioButtonGroup';

type MaxTokensMode = 'auto' | 'custom';

const MODE_ITEMS = [
  { value: 'auto', label: 'Auto' },
  { value: 'custom', label: 'Custom' },
] as const;

const MAX_TOKENS_LABEL = 'Max tokens';
const MAX_TOKENS_MODE_LABEL = 'Max tokens mode';
const REMAINING_TOKENS_LABEL = 'Remaining tokens';

interface MaxTokensSectionProps {
  value: number | string;
  onChange: (value: number | string | Event) => void;
  onBlur: () => void;
  onFocus: () => void;
  maxOutputTokens?: number | undefined;
  error?: boolean;
  helperText?: string | undefined;
}

/** Max tokens input field with an Auto/Custom mode switch. */
export const MaxTokensSection = memo(
  ({ value, onChange, onBlur, onFocus, maxOutputTokens, error, helperText }: MaxTokensSectionProps) => {
    const [mode, setMode] = useState<MaxTokensMode>(value === DEFAULT_MAX_TOKENS ? 'auto' : 'custom');

    // Sync mode when value changes from outside (e.g. when a dialog reopens).
    useEffect(() => {
      setMode(value === DEFAULT_MAX_TOKENS ? 'auto' : 'custom');
    }, [value]);

    const handleModeChange = useCallback(
      (nextMode: string) => {
        setMode(nextMode as MaxTokensMode);
        if (nextMode === 'auto') {
          onChange(DEFAULT_MAX_TOKENS);
        } else if (value === DEFAULT_MAX_TOKENS) {
          onChange(DEFAULT_MAX_TOKENS_CUSTOM);
        }
      },
      [onChange, value],
    );

    const handleClear = () => {
      onChange(DEFAULT_MAX_TOKENS);
    };

    const isAuto = mode === 'auto';

    const numericValue = typeof value === 'number' ? value : parseInt(String(value), 10);
    const remainingTokens =
      !isAuto && maxOutputTokens !== undefined && !Number.isNaN(numericValue)
        ? Math.max(maxOutputTokens - numericValue, 0)
        : '';

    return (
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="body2">{MAX_TOKENS_LABEL}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {maxOutputTokens !== undefined ? `Max: ${maxOutputTokens}` : ''}
          </Typography>
        </Box>
        <RadioButtonGroup
          value={mode}
          onChange={handleModeChange}
          items={MODE_ITEMS}
          aria-label={MAX_TOKENS_MODE_LABEL}
        />
        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
          <TextField
            value={isAuto ? 'Auto' : String(value)}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
            onBlur={onBlur}
            onFocus={onFocus}
            size="small"
            error={!!error}
            helperText={helperText}
            sx={{ flex: 1 }}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    {!isAuto && (
                      <IconButton
                        size="small"
                        onClick={handleClear}
                        edge="end"
                      >
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    )}
                  </InputAdornment>
                ),
              },
              htmlInput: {
                'aria-label': 'max_tokens',
                readOnly: isAuto,
                style: { textAlign: 'center' },
              },
            }}
          />
          {!isAuto && (
            <Box sx={{ flex: 1 }}>
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}
              >
                {REMAINING_TOKENS_LABEL}
              </Typography>
              <TextField
                value={remainingTokens}
                size="small"
                disabled
                fullWidth
                slotProps={{
                  htmlInput: {
                    'aria-label': 'remaining_tokens',
                    style: { textAlign: 'center' },
                  },
                }}
              />
            </Box>
          )}
        </Box>
      </Box>
    );
  },
);

MaxTokensSection.displayName = 'MaxTokensSection';
