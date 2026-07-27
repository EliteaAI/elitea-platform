import type { ReactNode } from 'react';
import { useCallback } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';

import { convertJsonToString, convertToJson } from '../../lib/json';
import { FieldHeader } from '../lib/field/FieldHeader';
import type { FieldMeta } from '../lib/field/jsonSchemaField.types';
import { ResizableCodeMirrorEditor } from '../ResizableCodeMirrorEditor';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface AnyOfPatternFieldProps {
  fieldKey: string;
  value: readonly unknown[] | undefined;
  meta: FieldMeta;
  onChange: (fieldKey: string, value: unknown[]) => void;
}

/**
 * A resizable JSON-array editor for a JSON-schema `anyOf`-typed tool-input
 * field — the baseline's fallback for array-shaped fields whose exact
 * element schema is a union, so no fixed enum/element type is available to
 * render a more specific control (contrast `CommonArrayField`, which reaches
 * for exactly this same editor as ITS OWN fallback branch, but has a first
 * branch — `property.items.enum` — that this field never gets to try).
 * Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/field/AnyOfPatternField.jsx`, which is
 * near-identical to `CommonArrayField.jsx`'s own JSON-editor branch (same
 * parse-to-array-or-empty-array logic, same `ResizableCodeMirrorEditor`
 * usage) — kept as its own small, self-contained component here too,
 * matching the baseline's own file split, rather than factoring out a
 * shared helper for ~10 duplicated lines.
 */
export function AnyOfPatternField({ fieldKey, value, meta, onChange }: AnyOfPatternFieldProps): ReactNode {
  const handleChange = useCallback(
    (newValue: string) => {
      const parsed = convertToJson(newValue);
      onChange(fieldKey, Array.isArray(parsed) ? parsed : []);
    },
    [fieldKey, onChange],
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
      <Box sx={(theme: Theme) => ({ marginTop: theme.spacing(1.5) })}>
        <ResizableCodeMirrorEditor
          expandAction
          value={convertJsonToString(value ?? [])}
          minHeight={100}
          onChange={handleChange}
          readOnly={meta.disabled}
          fieldName={meta.label}
        />
      </Box>
    </Box>
  );
}
