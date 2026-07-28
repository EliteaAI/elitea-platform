import type { ChangeEvent, ReactNode } from 'react';

import { ArrayFieldInput } from './ArrayFieldInput';
import { ToolActionsSelector } from './ToolActionsSelector';
import {
  BooleanField,
  CodeLanguageField,
  DefaultTextField,
  EnumSelectField,
  MaskedSecretField,
  MultilineField,
  ObjectField,
  SecretFieldInput,
} from './ToolBaseProperty.renderers';
import { isCredentialLikeKind, isIntegerKind, resolveAnyOfDefault } from './ToolBaseProperty.kinds';
import type { FieldKind } from './ToolBaseProperty.kinds';
import type { ToolBasePropertyCredentialContext, ToolBasePropertySlots } from './ToolBaseProperty.types';
import { MAX_NAME_LENGTH } from '@/shared/lib/limits';
import type { CredentialLikeFieldContext, EditToolField, OpenApiSpecFieldContext, SetToolErrors, ToolPropertySchema } from './types';

/**
 * Per-kind render functions plus the `RENDERERS` lookup table
 * `ToolBaseProperty.tsx` dispatches through — each function is its own
 * `eslint(complexity)` scope (§3.5 budget: 12), and the table itself is a
 * plain object literal, so `renderFieldByKind` (the one thing
 * `ToolBaseProperty.tsx` calls) stays at complexity 1 regardless of how
 * many kinds exist. Split out purely to keep the baseline's single
 * 700-line dispatch chain (`ToolBaseProperty.jsx:231-641`) under budget —
 * no behaviour change.
 */
export interface FieldRenderContext {
  readonly key: string;
  readonly schema: ToolPropertySchema;
  readonly label: string;
  readonly required: boolean;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly editField: EditToolField;
  readonly handleInputChange: (fieldPath: string) => (event: ChangeEvent<HTMLInputElement>) => void;
  readonly buildEditFieldPath: (fieldKey: string) => string;
  readonly toastError: boolean;
  readonly errorText: string | undefined;
  readonly effectiveDisabled: boolean;
  readonly noAccordionWrapper: boolean;
  readonly focusedField: string | undefined;
  readonly toggleFieldFocus: (field: string | undefined) => void;
  readonly credentialContext: ToolBasePropertyCredentialContext | undefined;
  readonly slots: ToolBasePropertySlots | undefined;
  readonly setToolErrors: SetToolErrors | undefined;
}

function renderOpenapiSpec(ctx: FieldRenderContext): ReactNode {
  if (!ctx.slots?.renderOpenApiSpecField) return null;
  const context: OpenApiSpecFieldContext = {
    value: (ctx.settings[ctx.key] as string | undefined) ?? '',
    onSchemaChange: (schemaText) => ctx.editField(ctx.buildEditFieldPath(ctx.key), schemaText),
    selectedTools: (ctx.settings['selected_tools'] as readonly string[] | undefined) ?? [],
    onSelectionChange: (toolName, enabled) => {
      const current = (ctx.settings['selected_tools'] as readonly string[] | undefined) ?? [];
      const next = enabled ? (current.includes(toolName) ? current : [...current, toolName]) : current.filter((name) => name !== toolName);
      ctx.editField(ctx.buildEditFieldPath('selected_tools'), next);
    },
    error: ctx.toastError,
    helperText: ctx.errorText,
    disabled: ctx.effectiveDisabled,
    setToolErrors: ctx.setToolErrors,
  };
  return ctx.slots.renderOpenApiSpecField(context);
}

function renderSelectedTools(ctx: FieldRenderContext): ReactNode {
  const items = ctx.schema.items;
  const argsSchemas = ctx.schema.args_schemas;
  const hasArgsSchemas = argsSchemas !== undefined && Object.keys(argsSchemas).length > 0;
  const tools = hasArgsSchemas ? Object.keys(argsSchemas) : (items?.enum ?? []);
  return (
    <ToolActionsSelector
      availableTools={tools}
      onChange={(value) => ctx.editField(ctx.buildEditFieldPath('selected_tools'), value)}
      disabled={ctx.effectiveDisabled}
    />
  );
}

function renderArray(ctx: FieldRenderContext): ReactNode {
  return (
    <ArrayFieldInput
      propertyKey={ctx.key}
      settings={ctx.settings}
      required={ctx.required}
      label={ctx.label}
      toastError={ctx.toastError}
      errorText={ctx.errorText}
      disableConfigFields={ctx.effectiveDisabled}
      disabled={ctx.effectiveDisabled}
      editField={ctx.editField}
      buildEditFieldPath={ctx.buildEditFieldPath}
    />
  );
}

function renderSecret(ctx: FieldRenderContext): ReactNode {
  if (ctx.effectiveDisabled) {
    return (
      <MaskedSecretField
        required={ctx.required}
        label={ctx.label}
        maxLength={ctx.schema.max_toolkit_length}
      />
    );
  }
  return (
    <SecretFieldInput
      value={ctx.settings[ctx.key] as string | undefined}
      onChange={(value) => ctx.editField(ctx.buildEditFieldPath(ctx.key), value)}
      label={ctx.label}
      required={ctx.required}
      error={ctx.toastError}
      helperText={ctx.errorText}
    />
  );
}

function renderObject(ctx: FieldRenderContext): ReactNode {
  const onChange = (rawText: string): void => {
    const textContent = rawText.trim();
    if (textContent === '') {
      ctx.editField(ctx.buildEditFieldPath(ctx.key), {});
      return;
    }
    try {
      const parsedValue = JSON.parse(textContent) as Readonly<Record<string, unknown>>;
      ctx.editField(ctx.buildEditFieldPath(ctx.key), parsedValue, true);
    } catch {
      ctx.editField(ctx.buildEditFieldPath(ctx.key), {}, true);
    }
  };
  return (
    <ObjectField
      value={ctx.settings[ctx.key] as Readonly<Record<string, unknown>> | undefined}
      title={ctx.schema.title}
      label={ctx.label}
      description={ctx.schema.description}
      required={ctx.required}
      readOnly={ctx.effectiveDisabled}
      noAccordionWrapper={ctx.noAccordionWrapper}
      onChange={onChange}
    />
  );
}

function renderBoolean(ctx: FieldRenderContext): ReactNode {
  return (
    <BooleanField
      checked={Boolean(ctx.settings[ctx.key])}
      label={ctx.label}
      description={ctx.schema.description}
      required={ctx.key === 'cloud' ? false : ctx.required}
      disabled={ctx.effectiveDisabled}
      onChange={(value) => ctx.editField(ctx.buildEditFieldPath(ctx.key), value)}
    />
  );
}

/** The current/default-resolved enum value — split out of `renderEnum` to keep that function's own complexity low. */
function resolveEnumValue(ctx: FieldRenderContext, options: readonly { value: string }[]): string {
  const currentValue = ctx.settings[ctx.key];
  if (options.some((option) => option.value === currentValue)) return currentValue as string;
  const schemaDefault = resolveAnyOfDefault(ctx.schema);
  if (options.some((option) => option.value === schemaDefault)) return schemaDefault as string;
  return '';
}

function renderEnum(ctx: FieldRenderContext): ReactNode {
  const options = (ctx.schema.enum ?? []).map((item) => ({ label: item, value: item }));
  return (
    <EnumSelectField
      label={ctx.label}
      description={ctx.schema.description}
      required={ctx.required}
      value={resolveEnumValue(ctx, options)}
      options={options}
      disabled={ctx.effectiveDisabled}
      onChange={(value) => ctx.editField(ctx.buildEditFieldPath(ctx.key), value)}
    />
  );
}

function renderCodeLanguage(ctx: FieldRenderContext): ReactNode {
  return (
    <CodeLanguageField
      label={ctx.label}
      value={(ctx.settings[ctx.key] as string | undefined) ?? ''}
      codeLanguage={ctx.schema.code_language}
      readOnly={ctx.effectiveDisabled}
      onChange={(value) => ctx.editField(ctx.buildEditFieldPath(ctx.key), value)}
    />
  );
}

function renderMultiline(ctx: FieldRenderContext): ReactNode {
  const rows = parseInt(String(ctx.schema.lines), 10);
  return (
    <MultilineField
      required={ctx.required}
      label={ctx.label}
      value={ctx.settings[ctx.key] as string | undefined}
      onChange={ctx.handleInputChange(ctx.buildEditFieldPath(ctx.key))}
      error={ctx.toastError}
      helperText={ctx.errorText}
      rows={rows}
      disabled={ctx.effectiveDisabled}
      maxLength={ctx.schema.max_toolkit_length}
      placeholder={ctx.schema.placeholder}
    />
  );
}

function renderCredentialLike(ctx: FieldRenderContext): ReactNode {
  if (!ctx.slots?.renderCredentialLikeField || !isCredentialLikeKind(ctx.schema.type)) return null;
  const context: CredentialLikeFieldContext = {
    kind: ctx.schema.type,
    propertyKey: ctx.key,
    schema: ctx.schema,
    label: ctx.label,
    required: ctx.required,
    disabled: ctx.effectiveDisabled,
    error: ctx.toastError,
    helperText: ctx.errorText,
    value: ctx.settings[ctx.key],
    onChange: (value, options) => ctx.editField(ctx.buildEditFieldPath(ctx.key), value as never, undefined, options),
    specifiedProjectId: ctx.credentialContext?.specifiedProjectId,
    presetOptions: ctx.credentialContext?.presetOptions,
    onCredentialReload: ctx.credentialContext?.onCredentialReload,
  };
  return ctx.slots.renderCredentialLikeField(context);
}

/** The default single-line text field's own `isInteger`/`maxLength`/`placeholder`/`showCharactersLeft` derivations, split out to keep `renderDefault` itself under the complexity budget. */
function resolveDefaultTextFieldPresentation(ctx: FieldRenderContext) {
  const isInteger = isIntegerKind(ctx.schema);
  const maxLength = ctx.key === 'label' ? MAX_NAME_LENGTH : ctx.schema.max_toolkit_length;
  const defaultValue = resolveAnyOfDefault(ctx.schema);
  const defaultValueText = typeof defaultValue === 'string' || typeof defaultValue === 'number' ? String(defaultValue) : undefined;
  const placeholder = ctx.schema.placeholder ?? (isInteger ? defaultValueText : undefined);
  const currentValue = ctx.settings[ctx.key];
  const showCharactersLeft =
    ctx.key === 'label' && ctx.focusedField === ctx.key && typeof currentValue === 'string' && currentValue.length === MAX_NAME_LENGTH;
  return { isInteger, maxLength, placeholder, currentValue, showCharactersLeft };
}

function renderDefault(ctx: FieldRenderContext): ReactNode {
  const { isInteger, maxLength, placeholder, currentValue, showCharactersLeft } = resolveDefaultTextFieldPresentation(ctx);
  return (
    <DefaultTextField
      field={{ required: ctx.required, label: ctx.label, description: ctx.schema.description, isInteger }}
      value={currentValue as string | number | undefined}
      onChange={ctx.handleInputChange(ctx.buildEditFieldPath(ctx.key))}
      focus={{ onFocus: () => ctx.toggleFieldFocus(ctx.key), onBlur: () => ctx.toggleFieldFocus(undefined) }}
      validation={{ error: ctx.toastError, helperText: ctx.errorText }}
      disabled={ctx.effectiveDisabled}
      maxLength={maxLength}
      placeholder={placeholder}
      showCharactersLeft={showCharactersLeft}
    />
  );
}

const RENDERERS: Readonly<Record<FieldKind, (ctx: FieldRenderContext) => ReactNode>> = {
  openapiSpec: renderOpenapiSpec,
  selectedTools: renderSelectedTools,
  array: renderArray,
  secret: renderSecret,
  object: renderObject,
  boolean: renderBoolean,
  enum: renderEnum,
  codeLanguage: renderCodeLanguage,
  multiline: renderMultiline,
  credentialLike: renderCredentialLike,
  default: renderDefault,
};

export function renderFieldByKind(kind: FieldKind, ctx: FieldRenderContext): ReactNode {
  return RENDERERS[kind](ctx);
}
