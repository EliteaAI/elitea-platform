/**
 * GenerateProjectContextReviewForm — form displayed inside the generate
 * modal for reviewing and editing the AI-generated context draft.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/project-context/GenerateProjectContextReviewForm.jsx`.
 */
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { memo, useCallback, useEffect, useMemo } from 'react';

import { t } from '@/shared/i18n';

export const APPLY_MODE = {
  REPLACE: 'replace',
  APPEND: 'append',
} as const;

export type ApplyMode = (typeof APPLY_MODE)[keyof typeof APPLY_MODE];

export interface GenerateProjectContextReviewFormProps {
  draft: { project_background?: string };
  onChange: (draft: { project_background?: string }) => void;
  onValidationChange?: (isValid: boolean) => void;
  hasExistingContent: boolean;
  existingContentLength: number;
  applyMode: ApplyMode;
  onApplyModeChange: (mode: ApplyMode) => void;
}

const MAX_CHARS = 2500;
const APPEND_SEPARATOR = '\n\n';

export const GenerateProjectContextReviewForm = memo(function GenerateProjectContextReviewForm({
  draft,
  onChange,
  onValidationChange,
  hasExistingContent,
  existingContentLength,
  applyMode,
  onApplyModeChange,
}: GenerateProjectContextReviewFormProps) {
  const projectBackground = draft.project_background || '';

  const { effectiveLength, charError, isValid } = useMemo(() => {
    const len =
      hasExistingContent && applyMode === APPLY_MODE.APPEND
        ? existingContentLength + APPEND_SEPARATOR.length + projectBackground.length
        : projectBackground.length;
    const exceeded = len > MAX_CHARS;
    return {
      effectiveLength: len,
      charError: exceeded,
      isValid: projectBackground.trim().length > 0 && !exceeded,
    };
  }, [projectBackground, hasExistingContent, applyMode, existingContentLength]);

  useEffect(() => {
    onValidationChange?.(isValid);
  }, [isValid, onValidationChange]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange({ ...draft, project_background: e.target.value });
    },
    [draft, onChange],
  );

  const sx = formStyles();

  return (
    <Box sx={sx.container}>
      <Box sx={sx.field}>
        <Typography sx={sx.label}>
          {t('entities.projectContext.reviewForm.projectBackground', 'Project Background')}
        </Typography>
        <TextField
          fullWidth
          size="small"
          multiline
          minRows={8}
          maxRows={16}
          value={projectBackground}
          onChange={handleChange}
          slotProps={{ htmlInput: { maxLength: MAX_CHARS } }}
          helperText={
            charError
              ? t('entities.projectContext.reviewForm.charExceeded', 'Combined content exceeds 2500 characters.')
              : `${effectiveLength}/${MAX_CHARS}`
          }
          error={charError}
          sx={sx.textField}
        />
      </Box>

      {hasExistingContent && (
        <Box sx={sx.field}>
          <Typography sx={sx.label}>
            {t('entities.projectContext.reviewForm.existingContent', 'Existing content detected')}
          </Typography>
          <RadioGroup
            value={applyMode}
            onChange={(e) => onApplyModeChange(e.target.value as ApplyMode)}
          >
            <FormControlLabel
              value={APPLY_MODE.REPLACE}
              control={<Radio size="small" />}
              label={t('entities.projectContext.reviewForm.replaceExisting', 'Replace existing content')}
              sx={sx.radio}
            />
            <FormControlLabel
              value={APPLY_MODE.APPEND}
              control={<Radio size="small" />}
              label={t('entities.projectContext.reviewForm.appendExisting', 'Append to existing content')}
              sx={sx.radio}
            />
          </RadioGroup>
        </Box>
      )}
    </Box>
  );
});

function formStyles(): Record<string, SxProps<Theme>> {
  return {
    container: {
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem',
    },
    field: {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
    },
    label: {
      fontSize: '0.875rem',
      fontWeight: 500,
      lineHeight: '1.5rem',
      color: 'text.primary',
    },
    radio: {
      '& .MuiFormControlLabel-label': {
        fontSize: '0.875rem',
      },
    },
    textField: ({ palette }) => ({
      '& .MuiOutlinedInput-root': {
        backgroundColor: palette.background.userInputBackground,
        borderRadius: '0.5rem',
        fontSize: '0.875rem',
        color: palette.text.secondary,
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: palette.border.lines,
        },
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: palette.border.lines,
        },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: palette.primary.main,
          borderWidth: '0.0625rem',
        },
      },
      '& .MuiFormHelperText-root': {
        fontSize: '0.625rem',
        margin: '0.125rem 0 0',
        color: 'text.primary',
        visibility: 'visible',
        lineHeight: '1rem',
        textAlign: 'right',
      },
      '& .MuiFormHelperText-root.Mui-error': {
        visibility: 'visible',
        color: 'error.main',
      },
    }),
  };
}
