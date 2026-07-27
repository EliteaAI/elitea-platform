import type { ReactNode } from 'react';
import { useCallback } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';

import { convertJsonToString, convertToJson } from '../../lib/json';
import { FieldHeader } from '../lib/field/FieldHeader';
import type { FieldMeta } from '../lib/field/jsonSchemaField.types';
import { ResizableCodeMirrorEditor } from '../ResizableCodeMirrorEditor';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface CommonObjectFieldProps {
  fieldKey: string;
  value: Record<string, unknown> | undefined;
  meta: FieldMeta;
  onChange: (fieldKey: string, value: Record<string, unknown>) => void;
}

/**
 * A JSON-object JSON-schema tool-input field: a resizable, expandable
 * `CodeMirrorEditor` editing the pretty-printed value as JSON text. Ported
 * from `apps/elitea-ui/src/[fsd]/shared/ui/field/CommonObjectField.jsx`.
 *
 * Baseline's own `JSON.stringify(fieldValue || {}, null, 2)` /
 * `JSON.parse(value)` (with a hand-rolled try/catch around the parse, empty
 * object on failure) are replaced with `shared/lib/json.ts`'s
 * `convertJsonToString`/`convertToJson` — unit S3's port of the same old-app
 * `utils.jsx` helpers, same fallback behaviour (parse failure -> `{}`,
 * silently), so this reuses the already-ported utility instead of
 * reimplementing it a second time.
 */
export function CommonObjectField({ fieldKey, value, meta, onChange }: CommonObjectFieldProps): ReactNode {
  const handleChange = useCallback(
    (newValue: string) => {
      // `convertToJson` (shared/lib/json.ts) already returns `{}` on any
      // parse failure — including an empty string, which `JSON.parse`
      // itself rejects — so it covers the baseline's explicit
      // `!value || value.trim() === ''` short-circuit without repeating it.
      // Preserved baseline quirk: neither this nor the original
      // `JSON.parse` call checks that the parsed result is actually an
      // object — typing `42`/`"null"`/`"[1,2]"` into the editor parses to
      // that literal value, not `{}`, same as the baseline.
      onChange(fieldKey, convertToJson(newValue) as Record<string, unknown>);
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
          value={convertJsonToString(value ?? {})}
          minHeight={100}
          onChange={handleChange}
          readOnly={meta.disabled}
          fieldName={meta.label}
        />
      </Box>
    </Box>
  );
}
