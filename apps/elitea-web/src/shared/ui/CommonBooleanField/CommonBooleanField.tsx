import type { ChangeEvent, ReactNode } from 'react';
import { useCallback } from 'react';

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import type { Theme } from '@mui/material/styles';

import { BaseCheckbox } from '../BaseCheckbox';
import { FieldHeader } from '../lib/field/FieldHeader';
import type { FieldMeta } from '../lib/field/jsonSchemaField.types';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface CommonBooleanFieldProps {
  /** The JSON-schema property name this field edits — passed back unchanged to `onChange`, and used as the checkbox's DOM `name`. */
  fieldKey: string;
  value: boolean | undefined;
  meta: FieldMeta;
  onChange: (fieldKey: string, value: boolean) => void;
}

/**
 * A labelled checkbox for a boolean JSON-schema tool-input field. Ported
 * from `apps/elitea-ui/src/[fsd]/shared/ui/field/CommonBooleanField.jsx`.
 *
 * Prop-shape deviation from the baseline (same rationale across the whole
 * `Common*Field` family — see `shared/ui/lib/field/jsonSchemaField.types.ts`):
 * baseline's `onChangeInputVariables(nextWholeToolInputVariablesObject)` +
 * `toolInputVariables` pair operated on an entire sibling-fields dict that
 * this component read `...toolInputVariables` out of and spread a single
 * key back into. That whole-object-merge responsibility belongs to
 * whichever form component owns the dict (a features/ layer that doesn't
 * exist yet in this app) — `shared/ui` stays a single-field, controlled
 * `(fieldKey, value) -> onChange` primitive; the caller does its own merge.
 */
export function CommonBooleanField({ fieldKey, value, meta, onChange }: CommonBooleanFieldProps): ReactNode {
  const { label, description, isRequired, disabled } = meta;

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange(fieldKey, event.target.checked);
    },
    [fieldKey, onChange],
  );

  return (
    <Box
      sx={(theme: Theme) => ({ marginTop: theme.spacing(2) })}
      className="index-config-field"
    >
      <FormControlLabel
        control={
          <BaseCheckbox
            name={fieldKey}
            checked={value ?? false}
            onChange={handleChange}
            disabled={disabled}
          />
        }
        label={
          <FieldHeader
            label={label}
            required={isRequired}
            description={description}
          />
        }
      />
    </Box>
  );
}
