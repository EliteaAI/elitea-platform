// @ts-nocheck — strict TS refinements pending
import { memo, type ChangeEvent } from 'react';

import { Box, IconButton, InputAdornment, TextField } from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';

import { DEFAULT_MAX_TOKENS } from '@/shared/lib/constants';

interface MaxTokensSectionProps {
  value: number | string;
  onChange: (value: number | string | Event) => void;
  onBlur: () => void;
  onFocus: () => void;
  maxOutputTokens?: number;
  error?: boolean;
  helperText?: string;
}

/** Max tokens input field. */
export const MaxTokensSection = memo(
  ({ value, onChange, onBlur, onFocus, maxOutputTokens, error, helperText }: MaxTokensSectionProps) => {
    const handleClear = () => {
      onChange(DEFAULT_MAX_TOKENS);
    };

    const isAuto = value === DEFAULT_MAX_TOKENS;

    return (
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="body2">Max tokens</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {maxOutputTokens !== undefined ? `Max: ${maxOutputTokens}` : ''}
          </Typography>
        </Box>
        <TextField
          value={isAuto ? 'Auto' : String(value)}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          onBlur={onBlur}
          onFocus={onFocus}
          size="small"
          error={!!error}
          helperText={helperText}
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
          }}
          inputProps={{
            'aria-label': 'max_tokens',
            readOnly: isAuto,
            style: { textAlign: 'center' },
          }}
        />
      </Box>
    );
  },
);

MaxTokensSection.displayName = 'MaxTokensSection';
