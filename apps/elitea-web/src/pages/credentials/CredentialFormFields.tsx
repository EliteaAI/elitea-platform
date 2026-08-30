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

import { useSecretFieldOptions } from '@/entities/secret';
import { classifySchemaField } from '@/features/credentials';
import type { ConfigSchemaNode } from '@/features/credentials';

export interface CredentialSchemaFieldProps {
  readonly fieldKey: string;
  readonly property: ConfigSchemaNode | undefined;
  readonly value: unknown;
  readonly error: string | undefined;
  readonly required: boolean;
  readonly onChange: (fieldKey: string, value: unknown) => void;
}

interface CommonMeta {
  readonly label: string;
  readonly description?: string;
  readonly isRequired: boolean;
}

function metaFor(fieldKey: string, property: ConfigSchemaNode | undefined, required: boolean): CommonMeta {
  const label = property?.title ?? fieldKey;
  return {
    label,
    isRequired: required,
    ...(property?.description !== undefined ? { description: property.description } : {}),
  };
}

/**
 * #441: `secrets` was never supplied here, so a credential's secret field
 * rendered as a plain masked text box — no mode toggle, no saved-secret
 * picker, and no "Create new secret" entry for any user, an administrator
 * included. `useSecretFieldOptions()` supplies the option list, the refresh
 * action and the create grant `SecretField` expects from its caller.
 *
 * A component, not a helper called from `CredentialSchemaField`: the hook
 * queries, and this mounts on the secret branch alone.
 */
function CredentialSecretField({ field, label }: { readonly field: CredentialSchemaFieldProps; readonly label: string }): ReactNode {
  const { fieldKey, value, error, required, onChange } = field;
  const secrets = useSecretFieldOptions();
  return (
    <SecretManagementInput
      name={fieldKey}
      label={label}
      required={required}
      value={typeof value === 'string' ? value : ''}
      onChange={(next) => {
        onChange(fieldKey, next);
      }}
      secrets={secrets}
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

function schemaNodesOf(value: unknown): readonly ConfigSchemaNode[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ConfigSchemaNode => typeof entry === 'object' && entry !== null);
}

function enumOptionsOf(property: ConfigSchemaNode | undefined): readonly string[] | undefined {
  const candidates = [property, ...schemaNodesOf(property?.['anyOf']), ...schemaNodesOf(property?.['oneOf'])];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const values = candidate.enum;
    if (Array.isArray(values)) return values.filter((entry): entry is string => typeof entry === 'string');
  }
  return undefined;
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
  const meta = metaFor(props.fieldKey, props.property, props.required);
  if (kind === 'secret')
    return (
      <CredentialSecretField
        key={props.fieldKey}
        field={props}
        label={meta.label}
      />
    );
  if (kind === 'boolean') return renderBooleanField(props, meta);
  if (kind === 'number') return renderNumberField(props, meta);
  return renderStringField(props, meta);
}
