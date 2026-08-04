/**
 * Individual row for displaying/editing one environment variable.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/environment/
 * EnvironmentFieldRow.jsx`.
 *
 * Renders:
 *  - A label with optional tooltip
 *  - A text or number input (type depends on schema)
 *  - A "Restore to default" button
 */
import { memo, useCallback, useMemo } from 'react';

import RestoreOutlinedIcon from '@mui/icons-material/RestoreOutlined';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import type { EnvironmentFieldDefinition } from '@/features/settings/lib/environment/environmentField.helpers';
import { isNumericType } from '@/features/settings/lib/environment/environmentField.helpers';
import { t } from '@/shared/i18n';
import { combineSx } from '@/shared/ui/lib/combineSx';

/* ── public API ───────────────────────────────────────────────────────── */

export interface EnvironmentFieldRowProps {
  /** Normalised field definition (key, label, type, defaults). */
  field: EnvironmentFieldDefinition;
  /** Current displayed value (always a string). */
  value: string;
  /** Whether all editing is disabled. */
  disabled?: boolean;
  /** Inline validation/save error message for this field, if any. */
  error?: string | undefined;
  /** Called when the field value changes. */
  onChange: (fieldKey: string, value: string) => void;
  /** Called when the field loses focus (triggers save). */
  onBlur: (fieldKey: string) => void;
  /** Called when the restore button is clicked. */
  onRestore: (fieldKey: string) => void;
  sx?: SxProps<Theme>;
}

/**
 * Single row in the environment settings section.
 */
export const EnvironmentFieldRow = memo(function EnvironmentFieldRow({
  field,
  value,
  disabled = false,
  error,
  onChange,
  onBlur,
  onRestore,
  sx,
}: EnvironmentFieldRowProps) {
  const numeric = isNumericType(field.type);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(field.key, e.target.value);
    },
    [field.key, onChange],
  );

  const handleBlur = useCallback(() => {
    onBlur(field.key);
  }, [field.key, onBlur]);

  const handleRestore = useCallback(() => {
    onRestore(field.key);
  }, [field.key, onRestore]);

  // `aria-label` is set unconditionally (matches the baseline
  // `EnvironmentFieldRow.jsx:30-42`) — numeric-only constraints are layered
  // on top only when `numeric` is true, but every field type gets a label.
  const slotProps = useMemo(
    () => ({
      input: {
        'aria-label': field.label,
        ...(numeric
          ? {
              min: field.minimum ?? 0,
              ...(field.maximum !== undefined ? { max: field.maximum } : {}),
              step: field.type === 'integer' ? 1 : 'any',
            }
          : {}),
      },
    }),
    [field.label, field.maximum, field.minimum, field.type, numeric],
  );

  return (
    <Box sx={combineSx(styles.fieldRow, sx)}>
      <Box sx={styles.labelContainer}>
        <Typography
          variant="bodyMedium"
          component="label"
          sx={styles.label}
        >
          {field.label}
        </Typography>
        {field.tooltip && (
          <Tooltip
            title={field.tooltip}
            placement="top"
          >
            <Box
              component="span"
              sx={styles.tooltipIcon}
            >
              {t('shared.ui.settings.environment.infoIcon', 'ⓘ')}
            </Box>
          </Tooltip>
        )}
      </Box>
      <Box sx={styles.inputContainer}>
        <TextField
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={disabled}
          error={Boolean(error)}
          helperText={error}
          fullWidth
          variant="standard"
          type={numeric ? 'number' : 'text'}
          slotProps={slotProps}
          sx={styles.textField}
        />
        <Tooltip
          title={t('shared.ui.settings.environment.restoreTooltip', 'Restore to default')}
          placement="top"
        >
          <Box
            component="span"
            sx={styles.restoreButtonWrapper}
          >
            <IconButton
              color="tertiary"
              onClick={handleRestore}
              disabled={disabled}
              aria-label={t('shared.ui.settings.environment.restore', 'Restore {{label}} to default', { label: field.label })}
              sx={styles.restoreButton}
            >
              <RestoreOutlinedIcon fontSize="small" />
            </IconButton>
          </Box>
        </Tooltip>
      </Box>
    </Box>
  );
});

/* ── styles ───────────────────────────────────────────────────────────── */

const styles: Record<string, SxProps<Theme>> = {
  fieldRow: {
    display: 'flex',
    flexDirection: 'column',
    width: '26.25rem',
    gap: '0.5rem',
  },
  labelContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    paddingLeft: '0.7rem',
  },
  label: {
    color: 'text.secondary',
    fontWeight: 500,
  },
  tooltipIcon: ({ typography }) => ({
    fontSize: typography.bodySmall.fontSize,
    opacity: 0.5,
    cursor: 'help',
  }),
  inputContainer: {
    display: 'flex',
    alignItems: 'center',
    flex: 1,
    gap: '0.25rem',
  },
  textField: {
    '& input:-webkit-autofill, & input:-webkit-autofill:hover, & input:-webkit-autofill:focus, & input:-webkit-autofill:active':
      ({ palette }) => ({
        WebkitBoxShadow: `0 0 0 62.5rem ${palette.background.tabPanel} inset`,
        WebkitTextFillColor: palette.text.secondary,
        caretColor: palette.text.secondary,
        transition: 'background-color 5000s ease-in-out 0s',
      }),
    '& input:-webkit-autofill::first-line': ({ palette }) => ({
      color: palette.text.secondary,
    }),
  },
  restoreButtonWrapper: {
    mt: '0.5rem',
  },
  restoreButton: ({ palette }) => ({
    '&:hover svg': {
      fill: palette.icon.fill.secondary,
    },
  }),
};
