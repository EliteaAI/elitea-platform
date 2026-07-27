import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import type { Theme } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';

import { CodeMirrorEditor } from '../CodeMirrorEditor';
import { CopyLinkIcon } from '../icons/copy-link-icon';
import { FieldHeader } from '../lib/field/FieldHeader';
import type { FieldMeta, JsonSchemaProperty } from '../lib/field/jsonSchemaField.types';
import { handleCopy } from '../../lib/clipboard';
import { t } from '../lib/t';

/** UI-facing config specific to `CommonStringField` — baseline's `fieldProperties` for this one field type, beyond the common `label`/`description`/`isRequired`/`disabled` (`FieldMeta`). */
export interface CommonStringFieldMeta extends FieldMeta {
  error?: string;
  /** Shows a copy-to-clipboard button next to the input. */
  clipboard?: boolean;
  /** Renders a `CodeMirrorEditor` instead of a text input, for this CodeMirror language id. */
  codeLanguage?: string;
  /** Minimum visible rows for the multiline text-input branch. */
  lines?: number;
  /** Renders a dropdown instead of a text input. `null`/`'null'`/`'None'` entries are filtered out — an explicit "None" option is added instead when the field is optional and has no schema default. */
  enumValues?: readonly string[];
}

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface CommonStringFieldProps {
  fieldKey: string;
  value: string | undefined;
  meta: CommonStringFieldMeta;
  /** The JSON-schema node for this field — read for `multiline`/`maxLength`/`default`. */
  property?: JsonSchemaProperty;
  onChange: (fieldKey: string, value: string | undefined) => void;
}

function computeIsMultiline(meta: CommonStringFieldMeta, property: JsonSchemaProperty | undefined): boolean {
  if (property?.multiline === true) return true;
  if (meta.lines !== undefined && meta.lines > 1) return true;
  if (property?.maxLength !== undefined && property.maxLength > 100) return true;
  return meta.description?.toLowerCase().includes('description') ?? false;
}

interface EnumOption {
  label: string;
  value: string;
}

function computeEnumOptions(meta: CommonStringFieldMeta, property: JsonSchemaProperty | undefined): EnumOption[] | null {
  if (!meta.enumValues) return null;
  const filtered = meta.enumValues.filter((option) => option !== null && option !== 'null' && option !== 'None');
  const hasDefault = property?.default !== undefined && property.default !== null;
  const options: EnumOption[] = [];
  if (!meta.isRequired && !hasDefault) {
    options.push({ label: t('shared.ui.commonStringField.none', 'None'), value: '' });
  }
  for (const option of filtered) {
    options.push({ label: option, value: option });
  }
  return options;
}

interface StringEnumFieldProps {
  meta: CommonStringFieldMeta;
  value: string | undefined;
  options: EnumOption[];
  onChange: (value: string) => void;
}

function StringEnumField({ meta, value, options, onChange }: StringEnumFieldProps): ReactNode {
  const handleChange = useCallback((event: SelectChangeEvent) => onChange(event.target.value), [onChange]);

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
        required={meta.isRequired}
        value={value ?? ''}
        onChange={handleChange}
        disabled={meta.disabled}
        displayEmpty
        aria-label={meta.label}
      >
        {options.map((option) => (
          <MenuItem
            key={option.value}
            value={option.value}
          >
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}

interface StringCodeFieldProps {
  meta: CommonStringFieldMeta;
  value: string | undefined;
  onChange: (value: string) => void;
}

function StringCodeField({ meta, value, onChange }: StringCodeFieldProps): ReactNode {
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
      <CodeMirrorEditor
        value={value ?? ''}
        minHeight="6.25rem"
        onBlur={onChange}
        readOnly={meta.disabled}
        aria-label={meta.label}
      />
    </Box>
  );
}

interface StringTextFieldProps {
  meta: CommonStringFieldMeta;
  value: string | undefined;
  isMultiline: boolean;
  maxLength: number | undefined;
  onChange: (value: string) => void;
}

function StringTextField({ meta, value, isMultiline, maxLength, onChange }: StringTextFieldProps): ReactNode {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    [onChange],
  );
  const handleCopyClick = useCallback(() => {
    void handleCopy(value ?? '');
  }, [value]);

  const minRows = meta.lines ?? (isMultiline ? 3 : 1);

  return (
    <Box
      sx={(theme: Theme) => ({ marginTop: theme.spacing(2), position: 'relative' })}
      className="index-config-field"
    >
      {meta.clipboard && (
        <Box
          sx={(theme: Theme) => ({ position: 'absolute', top: 0, right: 0, zIndex: 1, marginTop: theme.spacing(-0.5) })}
        >
          <Tooltip title={t('shared.ui.commonStringField.copy', 'Copy to clipboard')}>
            <IconButton
              color="tertiary"
              size="small"
              aria-label={t('shared.ui.commonStringField.copy', 'Copy to clipboard')}
              onClick={handleCopyClick}
            >
              <CopyLinkIcon
                width="0.875rem"
                height="0.875rem"
              />
            </IconButton>
          </Tooltip>
        </Box>
      )}
      <FieldHeader
        label={meta.label}
        required={meta.isRequired}
        description={meta.description}
      />
      <TextField
        variant="standard"
        fullWidth
        required={meta.isRequired}
        multiline={isMultiline}
        minRows={minRows}
        value={value ?? ''}
        onChange={handleChange}
        disabled={meta.disabled}
        error={Boolean(meta.error)}
        helperText={meta.error ?? null}
        sx={meta.clipboard ? { paddingRight: (theme: Theme) => theme.spacing(3) } : undefined}
        slotProps={{ htmlInput: { maxLength, 'aria-label': meta.label } }}
      />
    </Box>
  );
}

/**
 * A string JSON-schema tool-input field — an enum dropdown, a
 * `CodeMirrorEditor` (when `meta.codeLanguage` is set), or a text input,
 * with an optional copy-to-clipboard button. Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/field/CommonStringField.jsx`.
 *
 * Baseline's `useToast()` (`toastInfo('Content copied to clipboard')`
 * feedback after a successful copy) is an app-level hook this layer's
 * LAYERING rule cannot import (props/callbacks only, no app-level
 * context/hooks). `shared/lib/clipboard.ts#handleCopy` (unit S3's port of
 * the baseline's own `handleCopy`) does the copy itself; a caller that wants
 * a toast wires its own `onCopy` — not added here, since no in-scope
 * baseline call site passes one and it would be a 6th prop for a callback
 * nothing yet uses.
 */
export function CommonStringField({ fieldKey, value, meta, property, onChange }: CommonStringFieldProps): ReactNode {
  const isMultiline = useMemo(() => computeIsMultiline(meta, property), [meta, property]);
  const enumOptions = useMemo(() => computeEnumOptions(meta, property), [meta, property]);

  const handleChange = useCallback(
    (newValue: string) => onChange(fieldKey, newValue === '' ? undefined : newValue),
    [fieldKey, onChange],
  );

  if (enumOptions) {
    return (
      <StringEnumField
        meta={meta}
        value={value}
        options={enumOptions}
        onChange={handleChange}
      />
    );
  }

  if (meta.codeLanguage !== undefined) {
    return (
      <StringCodeField
        meta={meta}
        value={value}
        onChange={handleChange}
      />
    );
  }

  return (
    <StringTextField
      meta={meta}
      value={value}
      isMultiline={isMultiline}
      maxLength={property?.maxLength}
      onChange={handleChange}
    />
  );
}
