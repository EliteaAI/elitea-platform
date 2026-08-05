import type { ChangeEvent, ReactNode } from 'react';
import { useMemo, useState } from 'react';

import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { CharacterCounter } from '@/shared/ui/CharacterCounter';
import { Markdown } from '@/shared/ui/Markdown';

import {
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_INSTRUCTIONS_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  validateSkill,
} from '../lib/skillValidation';
import type { SkillWriteInput } from '../model/types';

export interface SkillFormProps {
  readonly value: SkillWriteInput;
  readonly onChange: (value: SkillWriteInput) => void;
  readonly disabled?: boolean;
  readonly showErrors?: boolean;
  readonly onGenerate?: () => void;
}

type FieldName = 'name' | 'description' | 'instructions';

function toTags(value: string): readonly string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

interface SkillFormHeaderProps {
  readonly disabled: boolean;
  readonly onGenerate: (() => void) | undefined;
}

function SkillFormHeader({ disabled, onGenerate }: SkillFormHeaderProps): ReactNode {
  return (
    <Box sx={headingRowSx}>
      <Typography variant="headingSmall">{t('skills.form.general', 'General')}</Typography>
      {onGenerate && (
        <BaseBtn
          variant="secondary"
          startIcon={<AutoAwesomeIcon />}
          disabled={disabled}
          onClick={onGenerate}
        >
          {t('skills.form.generate', 'Generate with AI')}
        </BaseBtn>
      )}
    </Box>
  );
}

export function SkillForm({
  value,
  onChange,
  disabled = false,
  showErrors = false,
  onGenerate,
}: SkillFormProps): ReactNode {
  const [preview, setPreview] = useState(false);
  const errors = useMemo(() => validateSkill(value), [value]);

  const changeField = (field: FieldName) => (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...value, [field]: event.target.value });
  };

  return (
    <Box sx={containerSx}>
      <SkillFormHeader
        disabled={disabled}
        onGenerate={onGenerate}
      />
      <Box sx={nameRowSx}>
        <Tooltip title={t('skills.form.iconUnavailable', 'Custom skill icons are coming soon.')}>
          <span>
            <BaseBtn
              variant="secondary"
              startIcon={<ImageOutlinedIcon />}
              disabled
            >
              {t('skills.form.icon', 'Icon')}
            </BaseBtn>
          </span>
        </Tooltip>
        <TextField
          fullWidth
          required
          label={t('skills.form.name', 'Name')}
          value={value.name}
          onChange={changeField('name')}
          disabled={disabled}
          error={showErrors && errors.name !== undefined}
          helperText={showErrors ? errors.name : undefined}
          slotProps={{ htmlInput: { maxLength: SKILL_NAME_MAX_LENGTH, 'data-testid': 'skill-name-input' } }}
        />
      </Box>
      <CharacterCounter
        value={value.name}
        maxLength={SKILL_NAME_MAX_LENGTH}
      />
      <TextField
        fullWidth
        required
        multiline
        minRows={2}
        label={t('skills.form.description', 'Description')}
        value={value.description}
        onChange={changeField('description')}
        disabled={disabled}
        error={showErrors && errors.description !== undefined}
        helperText={showErrors ? errors.description : undefined}
        slotProps={{
          htmlInput: { maxLength: SKILL_DESCRIPTION_MAX_LENGTH, 'data-testid': 'skill-description-input' },
        }}
      />
      <CharacterCounter
        value={value.description}
        maxLength={SKILL_DESCRIPTION_MAX_LENGTH}
      />
      <TextField
        fullWidth
        label={t('skills.form.tags', 'Tags')}
        value={value.tags.join(', ')}
        onChange={(event) => {
          onChange({ ...value, tags: toTags(event.target.value) });
        }}
        disabled={disabled}
        helperText={t('skills.form.tagsHint', 'Separate tags with commas.')}
        slotProps={{ htmlInput: { 'data-testid': 'skill-tags-input' } }}
      />
      <Box sx={headingRowSx}>
        <Typography variant="headingSmall">{t('skills.form.instructions', 'Instructions')}</Typography>
        <BaseBtn
          variant="secondary"
          disabled={disabled && !preview}
          onClick={() => {
            setPreview((current) => !current);
          }}
        >
          {preview ? t('skills.form.edit', 'Edit') : t('skills.form.preview', 'Preview')}
        </BaseBtn>
      </Box>
      {preview ? (
        <Box
          sx={previewSx}
          data-testid="skill-instructions-preview"
        >
          <Markdown>{value.instructions}</Markdown>
        </Box>
      ) : (
        <>
          <TextField
            fullWidth
            required
            multiline
            minRows={12}
            label={t('skills.form.instructions', 'Instructions')}
            value={value.instructions}
            onChange={changeField('instructions')}
            disabled={disabled}
            error={showErrors && errors.instructions !== undefined}
            helperText={showErrors ? errors.instructions : undefined}
            slotProps={{
              htmlInput: {
                maxLength: SKILL_INSTRUCTIONS_MAX_LENGTH,
                'data-testid': 'skill-instructions-input',
              },
            }}
          />
          <CharacterCounter
            value={value.instructions}
            maxLength={SKILL_INSTRUCTIONS_MAX_LENGTH}
          />
        </>
      )}
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1.5),
  maxWidth: '60rem',
});
const headingRowSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 1,
};
const nameRowSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1 };
const previewSx: SxProps<Theme> = (theme: Theme) => ({
  minHeight: '12rem',
  padding: theme.spacing(2),
  border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
  borderRadius: theme.vars.shape.radiusMd,
  backgroundColor: theme.vars.palette.background.secondary,
});
