import type { ChangeEvent, ReactNode } from 'react';
import { useEffect, useState } from 'react';

import TextField from '@mui/material/TextField';
import type { Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';

import type { EditToolField } from './types';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/form/ToolBase/
 * ArrayFieldInput.jsx` (67 lines) — the comma/space-separated text entry
 * for an array-typed field (e.g. OAuth `scopes`), committed to a real array
 * on blur.
 *
 * DISCLOSED SIMPLIFICATION: the baseline rendered through `@/components/
 * FormInput.jsx`, a 30-line wrapper that (when its `inputEnhancer` prop is
 * absent, which is every call site in this baseline file) does nothing but
 * spread `{fullWidth: true, autoComplete: 'off', variant: 'standard'}`
 * defaults onto a plain MUI `TextField`. `FormInput.jsx` is a top-level
 * `@/components/*` legacy file, not owned by this sub-unit and not
 * promoted; this port inlines its actual (trivial) behaviour — a bare
 * `TextField` with those same three defaults — rather than porting a
 * pass-through wrapper.
 */
export interface ArrayFieldInputProps {
  readonly propertyKey: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly required: boolean;
  readonly label: string;
  readonly toastError: boolean;
  readonly errorText: string | undefined;
  readonly disableConfigFields: boolean;
  readonly disabled: boolean | undefined;
  readonly editField: EditToolField;
  readonly buildEditFieldPath: (fieldKey: string) => string;
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : '';
}

export function ArrayFieldInput({
  propertyKey,
  settings,
  required,
  label,
  toastError,
  errorText,
  disableConfigFields,
  disabled,
  editField,
  buildEditFieldPath,
}: ArrayFieldInputProps): ReactNode {
  const [localValue, setLocalValue] = useState(() => displayValue(settings[propertyKey]));

  useEffect(() => {
    setLocalValue(displayValue(settings[propertyKey]));
  }, [settings, propertyKey]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setLocalValue(event.target.value);
  };

  const handleBlur = (): void => {
    const arrayResult = localValue
      ? localValue
          .split(/[,\s]+/)
          .map((segment) => segment.trim())
          .filter(Boolean)
      : [];
    editField(buildEditFieldPath(propertyKey), arrayResult);
  };

  return (
    <TextField
      fullWidth
      autoComplete="off"
      variant="standard"
      required={required}
      label={label}
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      error={toastError}
      helperText={
        errorText ??
        t('features.toolkits.toolBase.arrayFieldInput.helperText', 'Enter scopes separated by commas or spaces')
      }
      slotProps={{ formHelperText: { sx: helperTextSx } }}
      disabled={disableConfigFields || Boolean(disabled)}
    />
  );
}

function helperTextSx(theme: Theme) {
  return { marginTop: '0.25rem', color: theme.vars.palette.text.primary };
}
