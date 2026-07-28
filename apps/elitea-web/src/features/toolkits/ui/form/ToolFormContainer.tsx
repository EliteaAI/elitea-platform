import type { ReactNode } from 'react';
import { useMemo } from 'react';

import type { CommonStringFieldMeta } from '@/shared/ui/CommonStringField';
import { CommonStringField } from '@/shared/ui/CommonStringField';
import { CommonBooleanField } from '@/shared/ui/CommonBooleanField';
import { CommonNumberField } from '@/shared/ui/CommonNumberField';
import { CommonArrayField } from '@/shared/ui/CommonArrayField';
import { CommonObjectField } from '@/shared/ui/CommonObjectField';
import { AnyOfPatternField } from '@/shared/ui/AnyOfPatternField';
import { SecretInputField } from '@/shared/ui/SecretInputField';
import type { FieldMeta, JsonSchemaProperty } from '@/shared/ui/lib/field/jsonSchemaField.types';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/form/
 * ToolFormContainer.jsx` (169 lines). Per the mission brief: NOT used by
 * `ToolBase`/`ToolBaseProperty` (a sibling A4 sub-unit's own, separate
 * property-to-widget switch) — this component's only consumers are A4f's
 * `TestToolSettings.jsx` and A4a's `IndexConfig.jsx` (both intra-slice).
 *
 * DISCLOSED REDESIGN: `shared/ui`'s `Common*Field`/`AnyOfPatternField`/
 * `SecretInputField` family (unit S1-E) is a single-field, controlled
 * `(fieldKey, value) -> onChange` primitive — each takes its own `meta`
 * (`FieldMeta`, `label`/`description`/`isRequired`/`disabled`, plus a
 * per-component extension) instead of the baseline's one shared
 * `fieldPropsShared` blob built around a WHOLE-OBJECT
 * `onChangeInputVariables(prevState => ...)` setter + ambient
 * `toolInputVariables` dict (`CommonBooleanField.tsx`'s own doc comment:
 * "that whole-object-merge responsibility belongs to whichever form
 * component owns the dict ... the caller does its own merge"). This
 * component's own `onChangeInputVariables` prop is therefore now
 * `(fieldKey, value) => void` (single field), not a whole-object updater —
 * the caller (this sub-unit's `TestToolSettings.jsx`/A4a's `IndexConfig.jsx`)
 * owns the dict and does its own merge, matching that established
 * convention. Every OTHER behaviour — visibility (`visible_when`), the
 * secret-field/array-of-pattern-field detection rules, the field-type
 * dispatch switch, the anyOf[0]-only min/max lookup — is a faithful,
 * byte-for-byte port of this specific file's own logic (deliberately NOT
 * reusing `../../lib/helpers/toolBase.helpers.ts`'s more thorough
 * `getIntegerConstraints`, which searches every `anyOf` branch for an
 * integer type — this baseline file only ever reads `anyOf[0]`, a
 * genuinely different, separately-maintained implementation belonging to a
 * different baseline component).
 */
export interface ToolFormContainerProperty extends Omit<JsonSchemaProperty, 'anyOf'> {
  readonly title?: string;
  readonly description?: string;
  readonly format?: string;
  readonly secret?: boolean;
  readonly code_language?: string;
  readonly lines?: number;
  readonly enum?: readonly string[];
  readonly error?: string;
  readonly clipboard?: boolean;
  readonly hidden?: boolean;
  readonly visible_when?: { readonly field: string; readonly value: unknown };
  /** Overrides `JsonSchemaProperty`'s own (narrower) `anyOf` element type so branches carry this file's extra fields (`format`/`secret`) too. */
  readonly anyOf?: readonly ToolFormContainerProperty[];
}

export interface ToolFormContainerSchema {
  readonly required?: readonly string[];
}

export interface ToolFormContainerProps {
  readonly fieldKey: string;
  readonly property: ToolFormContainerProperty;
  readonly toolInputVariables: Readonly<Record<string, unknown>> | undefined;
  readonly schema: ToolFormContainerSchema | undefined;
  readonly onChangeInputVariables: (fieldKey: string, value: unknown) => void;
  readonly changesDisabled?: boolean;
}

const SECRET_FIELD_KEY_PATTERNS = ['password', 'secret', 'token', 'credential'];

function resolveFieldValue(fieldKey: string, property: ToolFormContainerProperty, toolInputVariables: Readonly<Record<string, unknown>> | undefined): unknown {
  const result = toolInputVariables?.[fieldKey];
  if ((result === undefined || typeof result === 'function') && property.default !== undefined) return property.default;
  return result;
}

/** `property.type`, else the non-`'null'` branch of an `anyOf` (Optional-type field). */
function resolveFieldType(property: ToolFormContainerProperty): string | undefined {
  if (property.type !== undefined) return property.type;
  return property.anyOf?.find((branch) => branch.type !== 'null')?.type;
}

/** Baseline: `anyOf[0]` only, NOT a search across every branch — see this file's own module doc comment. */
function resolveMinMax(fieldType: string | undefined, property: ToolFormContainerProperty): { readonly min: number | undefined; readonly max: number | undefined } {
  if (fieldType !== 'number' && fieldType !== 'integer') return { min: undefined, max: undefined };
  return { min: property.anyOf?.[0]?.minimum, max: property.anyOf?.[0]?.maximum };
}

function isArrayOfPatternField(property: ToolFormContainerProperty): boolean {
  return Boolean(property.anyOf?.some((branch) => branch.type === 'array'));
}

function isSecretField(fieldKey: string, property: ToolFormContainerProperty): boolean {
  if (property.format === 'password' || Boolean(property.secret)) return true;

  const branches = property.anyOf;
  if (branches !== undefined && branches.some((branch) => branch.format === 'password' || Boolean(branch.secret))) {
    return true;
  }

  const lowerKey = fieldKey.toLowerCase();
  return SECRET_FIELD_KEY_PATTERNS.some((pattern) => lowerKey.includes(pattern));
}

function isFieldVisible(property: ToolFormContainerProperty, toolInputVariables: Readonly<Record<string, unknown>> | undefined): boolean {
  const visibleWhen = property.visible_when;
  if (!visibleWhen) return true;

  const currentFieldValue = toolInputVariables?.[visibleWhen.field];
  return typeof currentFieldValue === 'string' && typeof visibleWhen.value === 'string'
    ? currentFieldValue.toLowerCase() === visibleWhen.value.toLowerCase()
    : currentFieldValue === visibleWhen.value;
}

interface FieldByTypeInput {
  readonly fieldKey: string;
  readonly fieldValue: unknown;
  readonly fieldType: string | undefined;
  readonly property: ToolFormContainerProperty;
  readonly baseMeta: FieldMeta;
  readonly stringMeta: CommonStringFieldMeta;
  readonly minFieldValue: number | undefined;
  readonly maxFieldValue: number | undefined;
  readonly onChangeInputVariables: (fieldKey: string, value: unknown) => void;
}

/** The type-dispatch switch, split out of `ToolFormContainer` purely to stay under the §3.5 cyclomatic-complexity budget (12) — an `if`/`else if` chain (not a `switch`) so the `string | undefined` `fieldType` needs no `case undefined` arm for `typescript(switch-exhaustiveness-check)`; `'string'`/every other/no type all fall through to the same `CommonStringField` default, exactly like the baseline's own `case 'string': default:` pair. */
function renderFieldByType({ fieldKey, fieldValue, fieldType, property, baseMeta, stringMeta, minFieldValue, maxFieldValue, onChangeInputVariables }: FieldByTypeInput): ReactNode {
  if (fieldType === 'object') {
    return (
      <CommonObjectField
        fieldKey={fieldKey}
        value={fieldValue as Record<string, unknown> | undefined}
        meta={baseMeta}
        onChange={onChangeInputVariables}
      />
    );
  }
  if (fieldType === 'boolean') {
    return (
      <CommonBooleanField
        fieldKey={fieldKey}
        value={typeof fieldValue === 'boolean' ? fieldValue : undefined}
        meta={baseMeta}
        onChange={onChangeInputVariables}
      />
    );
  }
  if (fieldType === 'integer' || fieldType === 'number') {
    return (
      <CommonNumberField
        fieldKey={fieldKey}
        value={typeof fieldValue === 'number' ? fieldValue : null}
        meta={baseMeta}
        property={property}
        fieldType={fieldType}
        onChange={onChangeInputVariables}
        {...(minFieldValue !== undefined ? { minFieldValue } : {})}
        {...(maxFieldValue !== undefined ? { maxFieldValue } : {})}
      />
    );
  }
  if (fieldType === 'array') {
    return (
      <CommonArrayField
        fieldKey={fieldKey}
        value={Array.isArray(fieldValue) ? fieldValue : undefined}
        meta={baseMeta}
        property={property}
        onChange={onChangeInputVariables}
      />
    );
  }
  return (
    <CommonStringField
      fieldKey={fieldKey}
      value={typeof fieldValue === 'string' ? fieldValue : undefined}
      meta={stringMeta}
      property={property}
      onChange={onChangeInputVariables}
    />
  );
}

export function ToolFormContainer({
  fieldKey,
  property,
  toolInputVariables,
  schema,
  onChangeInputVariables,
  changesDisabled = false,
}: ToolFormContainerProps): ReactNode {
  const fieldValue = useMemo(() => resolveFieldValue(fieldKey, property, toolInputVariables), [fieldKey, property, toolInputVariables]);
  const fieldType = useMemo(() => resolveFieldType(property), [property]);
  const { min: minFieldValue, max: maxFieldValue } = useMemo(() => resolveMinMax(fieldType, property), [fieldType, property]);

  /**
   * `exactOptionalPropertyTypes` (this app's tsconfig) rejects assigning an
   * explicit `x: T | undefined` value to a `x?: T` target — every optional
   * field below is therefore conditionally spread (key omitted entirely
   * when the source value is `undefined`) rather than always-present with
   * a possibly-`undefined` value, matching `shared/ui`'s own established
   * convention for this exact constraint (`FieldHeaderProps`'s doc comment).
   */
  const baseMeta: FieldMeta = useMemo(
    () => ({
      label: property.title ?? fieldKey,
      ...(property.description !== undefined ? { description: property.description } : {}),
      isRequired: schema?.required?.includes(fieldKey) ?? false,
      disabled: changesDisabled,
    }),
    [property.title, property.description, fieldKey, schema, changesDisabled],
  );

  const stringMeta: CommonStringFieldMeta = useMemo(
    () => ({
      ...baseMeta,
      ...(property.error !== undefined ? { error: property.error } : {}),
      clipboard: property.clipboard ?? false,
      ...(property.code_language !== undefined ? { codeLanguage: property.code_language } : {}),
      ...(property.lines !== undefined ? { lines: property.lines } : {}),
      ...(property.enum !== undefined ? { enumValues: property.enum } : {}),
    }),
    [baseMeta, property.error, property.clipboard, property.code_language, property.lines, property.enum],
  );

  if (!isFieldVisible(property, toolInputVariables)) return null;

  if (isArrayOfPatternField(property)) {
    return (
      <AnyOfPatternField
        fieldKey={fieldKey}
        value={Array.isArray(fieldValue) ? fieldValue : undefined}
        meta={baseMeta}
        onChange={onChangeInputVariables}
      />
    );
  }

  if (isSecretField(fieldKey, property)) {
    return (
      <SecretInputField
        fieldKey={fieldKey}
        value={typeof fieldValue === 'string' ? fieldValue : undefined}
        meta={baseMeta}
        onChange={onChangeInputVariables}
      />
    );
  }

  if (property.hidden) return null;

  return renderFieldByType({ fieldKey, fieldValue, fieldType, property, baseMeta, stringMeta, minFieldValue, maxFieldValue, onChangeInputVariables });
}
