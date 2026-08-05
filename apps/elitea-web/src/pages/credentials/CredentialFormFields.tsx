/**
 * pages/credentials/CredentialFormFields.tsx — one schema-driven form field
 * for `CredentialForm.tsx`'s per-type "data" section. Split into its own
 * file (out of `CredentialForm.tsx`) purely to keep each function under the
 * §3.5 cyclomatic-complexity budget — see that file's own doc comment for
 * the field-kind design rationale (secret/boolean/number/string, chosen by
 * `classifySchemaField`).
 */
import type { ReactNode } from 'react';

import { CommonBooleanField } from '@/shared/ui/CommonBooleanField';
import { CommonNumberField } from '@/shared/ui/CommonNumberField';
import { CommonStringField } from '@/shared/ui/CommonStringField';
import { SecretManagementInput } from '@/shared/ui/SecretManagementInput';

import { classifySchemaField } from '@/features/credentials';
import type { ConfigSchemaNode } from '@/features/credentials';

export interface CredentialSchemaFieldProps {
  readonly fieldKey: string;
  readonly property: ConfigSchemaNode | undefined;
  readonly value: unknown;
  readonly error: string | undefined;
  readonly onChange: (fieldKey: string, value: unknown) => void;
}

interface CommonMeta {
  readonly label: string;
  readonly description?: string;
}

function metaFor(fieldKey: string, property: ConfigSchemaNode | undefined): CommonMeta {
  const label = property?.title ?? fieldKey;
  return { label, ...(property?.description !== undefined ? { description: property.description } : {}) };
}

function renderSecretField({ fieldKey, value, error, onChange }: CredentialSchemaFieldProps, label: string): ReactNode {
  return (
    <SecretManagementInput
      key={fieldKey}
      name={fieldKey}
      label={label}
      value={typeof value === 'string' ? value : ''}
      onChange={(next) => {
        onChange(fieldKey, next);
      }}
      {...(error !== undefined ? { error: true, helperText: error } : {})}
    />
  );
}

function renderBooleanField({ fieldKey, value, onChange }: CredentialSchemaFieldProps, meta: CommonMeta): ReactNode {
  return (
    <CommonBooleanField
      key={fieldKey}
      fieldKey={fieldKey}
      value={typeof value === 'boolean' ? value : false}
      meta={meta}
      onChange={onChange}
    />
  );
}

function renderNumberField({ fieldKey, property, value, onChange }: CredentialSchemaFieldProps, meta: CommonMeta): ReactNode {
  return (
    <CommonNumberField
      key={fieldKey}
      fieldKey={fieldKey}
      value={typeof value === 'number' ? value : null}
      meta={meta}
      fieldType={property?.type === 'integer' ? 'integer' : 'number'}
      {...(property !== undefined ? { property } : {})}
      onChange={onChange}
    />
  );
}

function enumOptionsOf(property: ConfigSchemaNode | undefined): readonly string[] | undefined {
  if (!Array.isArray(property?.enum)) return undefined;
  return property.enum.filter((entry): entry is string => typeof entry === 'string');
}

function renderStringField({ fieldKey, property, value, error, onChange }: CredentialSchemaFieldProps, meta: CommonMeta): ReactNode {
  const enumValues = enumOptionsOf(property);
  return (
    <CommonStringField
      key={fieldKey}
      fieldKey={fieldKey}
      value={typeof value === 'string' ? value : ''}
      meta={{ ...meta, ...(error !== undefined ? { error } : {}), ...(enumValues !== undefined ? { enumValues } : {}) }}
      onChange={onChange}
    />
  );
}

/** Dispatches to the right widget for one schema property, by `classifySchemaField`'s kind. */
export function CredentialSchemaField(props: CredentialSchemaFieldProps): ReactNode {
  const kind = classifySchemaField(props.fieldKey, props.property);
  const meta = metaFor(props.fieldKey, props.property);
  if (kind === 'secret') return renderSecretField(props, meta.label);
  if (kind === 'boolean') return renderBooleanField(props, meta);
  if (kind === 'number') return renderNumberField(props, meta);
  return renderStringField(props, meta);
}
