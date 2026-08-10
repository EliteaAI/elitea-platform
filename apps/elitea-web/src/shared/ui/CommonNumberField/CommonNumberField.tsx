import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';
import type { Theme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';

import { FieldHeader } from '../lib/field/FieldHeader';
import type { FieldMeta, JsonSchemaProperty } from '../lib/field/jsonSchemaField.types';
import { t } from '@/shared/i18n';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface CommonNumberFieldProps {
  fieldKey: string;
  value: number | null | undefined;
  meta: FieldMeta;
  /** The JSON-schema node for this field — read for `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`/`default`, including inside an `anyOf` (Optional-type) wrapper. */
  property?: JsonSchemaProperty;
  fieldType: 'integer' | 'number';
  /** When both `minFieldValue` and `maxFieldValue` are given, renders a slider instead of a text input. */
  minFieldValue?: number;
  maxFieldValue?: number;
  onChange: (fieldKey: string, value: number | null) => void;
}

interface NumericConstraints {
  exclusiveMinimum: number | undefined;
  exclusiveMaximum: number | undefined;
  minimum: number | undefined;
  maximum: number | undefined;
}

/** `exclusiveMinimum`/`exclusiveMaximum`/`minimum`/`maximum`, resolved from `property` directly or, for an Optional-type field, from inside its `anyOf` numeric branch. */
function useNumericConstraints(property: JsonSchemaProperty | undefined): NumericConstraints {
  return useMemo(() => {
    let exclusiveMinimum = property?.exclusiveMinimum;
    let exclusiveMaximum = property?.exclusiveMaximum;
    let minimum = property?.minimum;
    let maximum = property?.maximum;

    const numericBranch = property?.anyOf?.find((item) => item.type === 'integer' || item.type === 'number');
    if (numericBranch) {
      exclusiveMinimum ??= numericBranch.exclusiveMinimum;
      exclusiveMaximum ??= numericBranch.exclusiveMaximum;
      minimum ??= numericBranch.minimum;
      maximum ??= numericBranch.maximum;
    }

    return { exclusiveMinimum, exclusiveMaximum, minimum, maximum };
  }, [property]);
}

/** The first constraint `value` breaches, as a user-facing message — `null` when it satisfies all of them (or there is nothing to check). */
function validateNumber(value: number | null | undefined, constraints: NumericConstraints): string | null {
  if (value === null || value === undefined) return null;
  const { exclusiveMinimum, minimum, exclusiveMaximum, maximum } = constraints;

  if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) {
    return t('shared.ui.commonNumberField.mustBeGreaterThan', 'Value must be greater than {{min}}', { min: exclusiveMinimum });
  }
  if (minimum !== undefined && value < minimum) {
    return t('shared.ui.commonNumberField.mustBeAtLeast', 'Value must be at least {{min}}', { min: minimum });
  }
  if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) {
    return t('shared.ui.commonNumberField.mustBeLessThan', 'Value must be less than {{max}}', { max: exclusiveMaximum });
  }
  if (maximum !== undefined && value > maximum) {
    return t('shared.ui.commonNumberField.mustBeAtMost', 'Value must be at most {{max}}', { max: maximum });
  }
  return null;
}

/** Parses a text-input's raw string per `fieldType`, matching `ToolBase`'s integer-stripping convention (baseline quirk, preserved: no minus sign or decimal point survive the integer path). Empty input is `null`, not `0`/`NaN`. */
function parseNumberInput(rawValue: string, fieldType: 'integer' | 'number'): number | null {
  if (rawValue === '') return null;
  if (fieldType === 'integer') {
    const digitsOnly = rawValue.replace(/[^0-9]/g, '');
    return digitsOnly === '' ? null : parseInt(digitsOnly, 10);
  }
  const parsed = parseFloat(rawValue);
  return Number.isNaN(parsed) ? null : parsed;
}

interface NumberSliderFieldProps {
  meta: FieldMeta;
  value: number | null | undefined;
  fieldType: 'integer' | 'number';
  min: number;
  max: number;
  defaultValue: number;
  onChange: (value: number) => void;
}

/** The bounded-range branch (`minFieldValue`/`maxFieldValue` both given) — split out to keep `CommonNumberField` itself under the §3.5 cyclomatic-complexity budget. */
function NumberSliderField({ meta, value, fieldType, min, max, defaultValue, onChange }: NumberSliderFieldProps): ReactNode {
  const handleChange = useCallback(
    (_event: Event, newValue: number | number[]) => {
      onChange(Array.isArray(newValue) ? (newValue[0] ?? min) : newValue);
    },
    [onChange, min],
  );

  return (
    <Box
      sx={(theme: Theme) => ({ marginTop: theme.spacing(2) })}
      className="index-config-field"
    >
      <FieldHeader
        label={`${meta.label} (${min} - ${max})`}
        required={meta.isRequired}
        description={meta.description}
      />
      <Slider
        value={value ?? defaultValue}
        step={fieldType === 'integer' ? 1 : 0.1}
        min={min}
        max={max}
        onChange={handleChange}
        disabled={meta.disabled}
        valueLabelDisplay="auto"
        aria-label={meta.label}
      />
    </Box>
  );
}

interface NumberTextFieldProps {
  meta: FieldMeta;
  value: number | null | undefined;
  fieldType: 'integer' | 'number';
  constraints: NumericConstraints;
  onChange: (value: number | null) => void;
}

/** The free-text branch — split out for the same reason as `NumberSliderField`. */
function NumberTextField({ meta, value, fieldType, constraints, onChange }: NumberTextFieldProps): ReactNode {
  const validationError = validateNumber(value, constraints);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange(parseNumberInput(event.target.value, fieldType));
    },
    [fieldType, onChange],
  );

  const min =
    fieldType === 'integer' && constraints.exclusiveMinimum !== undefined
      ? constraints.exclusiveMinimum + 1
      : constraints.minimum;
  const max =
    fieldType === 'integer' && constraints.exclusiveMaximum !== undefined
      ? constraints.exclusiveMaximum - 1
      : constraints.maximum;

  return (
    <Box
      sx={(theme: Theme) => ({ marginTop: theme.spacing(2) })}
      className="index-config-field"
    >
      <FieldHeader
        label={meta.label}
        required={meta.isRequired}
        description={meta.description}
      />
      <TextField
        variant="standard"
        fullWidth
        required={meta.isRequired}
        // Baseline quirk, preserved: `'tel'` (not `'number'`) for integer
        // fields — a numeric mobile keyboard without the native number
        // input's scroll-wheel/spinner value changes.
        type={fieldType === 'integer' ? 'tel' : 'number'}
        value={value ?? ''}
        onChange={handleChange}
        disabled={meta.disabled}
        error={validationError !== null}
        helperText={validationError}
        slotProps={{
          // `FieldHeader` above renders the visible label as a
          // `<Typography>`, not a `<label for>`/wrapping `<label>` — this
          // input otherwise has no accessible name at all (Storybook's a11y
          // addon caught it: "Form elements must have labels"). A top-level
          // `aria-label` prop on `<TextField>` lands on its outer
          // `FormControl` root, not the actual `<input>` (verified: it had
          // no effect) — `slotProps.htmlInput` is the one that reaches the
          // input element itself.
          htmlInput: { step: fieldType === 'integer' ? 1 : 'any', min, max, 'aria-label': meta.label },
        }}
      />
    </Box>
  );
}

/**
 * A numeric JSON-schema tool-input field: a slider when the caller supplies
 * a bounded `minFieldValue`/`maxFieldValue` range, otherwise a validated
 * text input. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/field/CommonNumberField.jsx`.
 *
 * The baseline's slider branch used a bespoke `@/components/Slider.jsx`
 * (not part of this unit's `shared/ui` port scope, and not built in this
 * app). MUI's own `Slider` renders the same "bounded numeric drag control"
 * behaviour directly, so it replaces the unported dependency rather than
 * leaving the slider path unbuilt.
 */
export function CommonNumberField({
  fieldKey,
  value,
  meta,
  property,
  fieldType,
  minFieldValue,
  maxFieldValue,
  onChange,
}: CommonNumberFieldProps): ReactNode {
  const constraints = useNumericConstraints(property);

  const handleChange = useCallback((newValue: number | null) => onChange(fieldKey, newValue), [fieldKey, onChange]);

  if (minFieldValue !== undefined && maxFieldValue !== undefined) {
    const defaultValue = typeof property?.default === 'number' ? property.default : minFieldValue;
    return (
      <NumberSliderField
        meta={meta}
        value={value}
        fieldType={fieldType}
        min={minFieldValue}
        max={maxFieldValue}
        defaultValue={defaultValue}
        onChange={handleChange}
      />
    );
  }

  return (
    <NumberTextField
      meta={meta}
      value={value}
      fieldType={fieldType}
      constraints={constraints}
      onChange={handleChange}
    />
  );
}
