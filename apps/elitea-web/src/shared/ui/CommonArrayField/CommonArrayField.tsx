import type { ReactNode } from 'react';
import { useCallback } from 'react';

import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import type { Theme } from '@mui/material/styles';

import { convertJsonToString, convertToJson } from '../../lib/json';
import { FieldHeader } from '../lib/field/FieldHeader';
import type { FieldMeta, JsonSchemaProperty } from '../lib/field/jsonSchemaField.types';
import { CheckboxCheckedIcon } from '../icons/checkbox-checked-icon';
import { CheckboxEmptyIcon } from '../icons/checkbox-empty-icon';
import { ResizableCodeMirrorEditor } from '../ResizableCodeMirrorEditor';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface CommonArrayFieldProps {
  fieldKey: string;
  value: readonly unknown[] | undefined;
  meta: FieldMeta;
  /** The JSON-schema node for this field — an `items.enum` list renders a multi-select instead of the default JSON editor. */
  property?: JsonSchemaProperty;
  onChange: (fieldKey: string, value: unknown[]) => void;
}

interface ArrayEnumFieldProps {
  meta: FieldMeta;
  value: readonly unknown[] | undefined;
  options: readonly string[];
  onChange: (value: string[]) => void;
}

/** The `property.items.enum` branch — a checkbox multi-select. Split out to keep `CommonArrayField` itself small and single-purpose. */
function ArrayEnumField({ meta, value, options, onChange }: ArrayEnumFieldProps): ReactNode {
  const selected = Array.isArray(value) ? (value as string[]) : [];

  const handleChange = useCallback(
    (event: SelectChangeEvent<string[]>) => {
      const { value: nextValue } = event.target;
      onChange(typeof nextValue === 'string' ? nextValue.split(',') : nextValue);
    },
    [onChange],
  );

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
      <Select
        variant="standard"
        fullWidth
        multiple
        required={meta.isRequired}
        value={selected}
        onChange={handleChange}
        disabled={meta.disabled}
        renderValue={(selectedValues) => selectedValues.join(', ')}
        aria-label={meta.label}
      >
        {options.map((option) => {
          const isSelected = selected.includes(option);
          return (
            <MenuItem
              key={option}
              value={option}
            >
              {/*
                Purely decorative: the enclosing `MenuItem` already has
                `role="option"` and communicates checked-ness via
                `aria-selected` (MUI sets this from the `Select`'s own
                value/multiple state) and is itself the click target. A
                real, focusable `<input type="checkbox">` nested inside it
                (this component's first attempt, using `BaseCheckbox`) is
                exactly what axe's `nested-interactive` rule flags — and
                `aria-hidden`/`tabIndex={-1}` on the input do NOT satisfy
                it, per axe's own message on that failure: "a negative
                tabindex... does not prevent assistive technologies from
                focusing the element (even with aria-hidden)". Rendering
                the checked/unchecked glyph as a plain `aria-hidden` icon —
                no `<input>`, nothing independently focusable — is the
                actual fix, not a stricter version of the same approach.
              */}
              <Box
                component={isSelected ? CheckboxCheckedIcon : CheckboxEmptyIcon}
                aria-hidden="true"
                sx={(theme: Theme) => ({
                  width: theme.spacing(2),
                  height: theme.spacing(2),
                  marginInlineEnd: theme.spacing(1),
                  flexShrink: 0,
                })}
              />
              {option}
            </MenuItem>
          );
        })}
      </Select>
    </Box>
  );
}

/**
 * An array JSON-schema tool-input field: a checkbox multi-select when the
 * schema gives a closed `items.enum` list, otherwise a resizable JSON
 * editor. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/field/CommonArrayField.jsx`.
 *
 * The baseline's enum branch used `Select.SingleSelect` in `multiple` mode
 * (`@/[fsd]/shared/ui/select`) — a sibling `shared/ui` slice this unit does
 * not own and, at the time of writing, has not landed. MUI's own `Select
 * multiple` + `MenuItem`/`Checkbox` renders the same "checkbox multi-select
 * dropdown" behaviour directly, so it replaces the not-yet-available
 * dependency instead of leaving the enum branch unbuilt.
 */
export function CommonArrayField({ fieldKey, value, meta, property, onChange }: CommonArrayFieldProps): ReactNode {
  const enumOptions = property?.items?.enum;

  const handleEnumChange = useCallback((newValue: string[]) => onChange(fieldKey, newValue), [fieldKey, onChange]);

  const handleJsonChange = useCallback(
    (newValue: string) => {
      const parsed = convertToJson(newValue);
      onChange(fieldKey, Array.isArray(parsed) ? parsed : []);
    },
    [fieldKey, onChange],
  );

  if (enumOptions) {
    return (
      <ArrayEnumField
        meta={meta}
        value={value}
        options={enumOptions}
        onChange={handleEnumChange}
      />
    );
  }

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
      <ResizableCodeMirrorEditor
        expandAction
        value={convertJsonToString(value ?? [])}
        minHeight={100}
        onChange={handleJsonChange}
        readOnly={meta.disabled}
        fieldName={meta.label}
      />
    </Box>
  );
}
