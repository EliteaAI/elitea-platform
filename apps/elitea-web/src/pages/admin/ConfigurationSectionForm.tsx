/**
 * The schema-driven form for one Configuration section — unit A14, issue #200.
 *
 * The server sends field specs; this renders a control per spec. It renders
 * exactly the widget kinds the AVAILABLE section needs — boolean, string,
 * enum-as-select, multiline string, number and the `*_links` editor — and, for a
 * spec it has no honest widget for, a disabled row saying so.
 *
 * That last part is the whole design. The reference's `SchemaField.jsx` falls
 * back to a raw JSON CodeMirror for `object` fields and to a chips input for
 * arrays it does not recognise, so a field whose editor was never written still
 * LOOKS editable. Here it says it is not. No available section declares such a
 * field today, so the branch is unreached in production and covered by a unit
 * test — but it is the branch that keeps the next section honest when one does.
 */
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { ConfigurationLinksEditor, toConfigLinks } from './ConfigurationLinksEditor';
import type { AdminConfigField } from './api/adminConfigurationApi';

/**
 * Whether a field's `visible_when` is satisfied by the current values.
 *
 * The schema uses this to hide a dependent field — the OIDC fields behind
 * `auth_provider = oidc`, the whitelist behind `is_publish_blocked`. Absent
 * means always visible. An ARRAY of conditions means ALL of them, which is how
 * the schema's `litellm_db_name` reads.
 */
export function isFieldVisible(
  field: AdminConfigField,
  values: Readonly<Record<string, unknown>>,
): boolean {
  const condition = field.visible_when;
  if (condition === undefined) return true;
  // Declared as a union of one condition or many; `Array.isArray` on a readonly
  // array widens to `any[]`, so the narrowing is written out rather than
  // inferred.
  const conditions: ReadonlyArray<{ readonly field: string; readonly value: unknown }> =
    Array.isArray(condition)
      ? (condition as ReadonlyArray<{ readonly field: string; readonly value: unknown }>)
      : [condition as { readonly field: string; readonly value: unknown }];
  return conditions.every((entry) => values[entry.field] === entry.value);
}

/**
 * The widget a spec resolves to, decided once so the form and its tests cannot
 * disagree about it.
 *
 * `links` is matched on the KEY suffix rather than on the type, because the
 * schema types those fields as plain arrays — the `items` shape is what makes
 * them links, and the same suffix is what the server's validator keys on.
 */
export type ConfigWidget = 'links' | 'boolean' | 'select' | 'multiline' | 'text' | 'number' | 'none';

export function widgetFor(field: AdminConfigField): ConfigWidget {
  if (field.key.endsWith('_links')) return 'links';
  if (field.type === 'boolean') return 'boolean';
  if (field.type === 'string') {
    if (field.enum !== undefined && field.enum.length > 0) return 'select';
    return field.format === 'textarea' ? 'multiline' : 'text';
  }
  if (field.type === 'integer' || field.type === 'number') return 'number';
  return 'none';
}

interface FieldProps {
  readonly field: AdminConfigField;
  readonly value: unknown;
  readonly disabled: boolean;
  readonly onChange: (key: string, next: unknown) => void;
}

function fieldLabel(field: AdminConfigField): string {
  return field.title === '' ? field.key : field.title;
}

/** Title + description above a control that cannot carry its own label. */
function FieldHeading({ field }: { readonly field: AdminConfigField }) {
  return (
    <>
      <Typography variant="bodyMedium">{fieldLabel(field)}</Typography>
      {field.description !== undefined && field.description !== '' ? (
        <Typography variant="bodySmall" color="text.secondary" component="div">
          {field.description}
        </Typography>
      ) : null}
    </>
  );
}

function BooleanField({ field, value, disabled, onChange }: FieldProps) {
  return (
    <FormControlLabel
      control={
        <Switch
          checked={value === true}
          disabled={disabled}
          slotProps={{ input: { 'aria-label': fieldLabel(field) } }}
          onChange={(event) => {
            onChange(field.key, event.target.checked);
          }}
        />
      }
      label={
        <Box>
          <FieldHeading field={field} />
        </Box>
      }
      sx={{ alignItems: 'flex-start', margin: 0, gap: '0.5rem' }}
    />
  );
}

function LinksField({ field, value, disabled, onChange }: FieldProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      <FieldHeading field={field} />
      <ConfigurationLinksEditor
        fieldKey={field.key}
        label={fieldLabel(field)}
        links={toConfigLinks(value)}
        disabled={disabled}
        onChange={(next) => {
          onChange(field.key, next);
        }}
      />
    </Box>
  );
}

/**
 * A spec this platform has no honest editor for.
 *
 * The reference falls back to a raw JSON CodeMirror, so a field whose editor was
 * never written still looks editable. This says it is not, and says why.
 */
function UnsupportedField({ field }: { readonly field: AdminConfigField }) {
  return (
    <TextField
      size="small"
      label={fieldLabel(field)}
      value=""
      disabled
      helperText={t(
        'pages.admin.configuration.field.unsupported',
        'This platform has no editor for this field yet, so it is shown read-only rather than as a control that discards what you type.',
      )}
    />
  );
}

function SelectField({ field, value, disabled, onChange }: FieldProps) {
  return (
    <TextField
      select
      size="small"
      label={fieldLabel(field)}
      helperText={field.description}
      value={typeof value === 'string' ? value : ''}
      disabled={disabled}
      onChange={(event) => {
        onChange(field.key, event.target.value);
      }}
    >
      {(field.enum ?? []).map((option) => (
        <MenuItem key={option} value={option}>
          {option}
        </MenuItem>
      ))}
    </TextField>
  );
}

function NumberField({ field, value, disabled, onChange }: FieldProps) {
  return (
    <TextField
      size="small"
      type="number"
      label={fieldLabel(field)}
      helperText={field.description}
      value={typeof value === 'number' ? String(value) : ''}
      disabled={disabled}
      onChange={(event) => {
        const text = event.target.value;
        // An empty box is `null`, never `0`. `Number('')` is 0, and a budget or
        // a project id silently becoming zero is a value a form must not invent.
        onChange(field.key, text === '' ? null : Number(text));
      }}
    />
  );
}

function TextFieldRow({ field, value, disabled, onChange, multiline }: FieldProps & { readonly multiline: boolean }) {
  return (
    <TextField
      size="small"
      label={fieldLabel(field)}
      helperText={field.description}
      multiline={multiline}
      minRows={multiline ? 4 : undefined}
      value={typeof value === 'string' ? value : ''}
      disabled={disabled}
      onChange={(event) => {
        onChange(field.key, event.target.value);
      }}
    />
  );
}

function FieldRow(props: FieldProps) {
  switch (widgetFor(props.field)) {
    case 'boolean':
      return <BooleanField {...props} />;
    case 'links':
      return <LinksField {...props} />;
    case 'none':
      return <UnsupportedField field={props.field} />;
    case 'select':
      return <SelectField {...props} />;
    case 'number':
      return <NumberField {...props} />;
    case 'multiline':
      return <TextFieldRow {...props} multiline />;
    case 'text':
      return <TextFieldRow {...props} multiline={false} />;
  }
}

export function ConfigurationSectionForm({
  fields,
  values,
  disabled,
  onChange,
}: {
  readonly fields: readonly AdminConfigField[];
  readonly values: Readonly<Record<string, unknown>>;
  readonly disabled: boolean;
  readonly onChange: (key: string, next: unknown) => void;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {fields
        .filter((field) => isFieldVisible(field, values))
        .map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            value={values[field.key]}
            disabled={disabled}
            onChange={onChange}
          />
        ))}
    </Box>
  );
}
