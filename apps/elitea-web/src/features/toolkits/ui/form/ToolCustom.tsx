import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { ConfigurationMode } from '@/entities/toolkit';
import { t } from '@/shared/i18n';
import { handleCopy } from '@/shared/lib/clipboard';
import { isNullOrUndefined } from '@/shared/lib/object';
import { CodeMirrorEditor } from '@/shared/ui/CodeMirrorEditor';
import { CopyLinkIcon } from '@/shared/ui/icons/copy-link-icon';

import { validationSettings } from '../../lib/helpers/toolCustom.helpers';
import type { ToolCustomSchema } from '../../lib/helpers/toolCustom.helpers';
import { useGetCurrentToolkitSchemas } from '../../lib/hooks/useGetCurrentToolkitSchemas.hooks';
import { useToolkitNameProp } from '../../lib/hooks/useToolkitNameProp.hooks';

import { getCodeLanguageExtensions } from './ToolBase/codeLanguageExtensions';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/form/
 * ToolCustom.jsx` (265 lines) — the generic JSON settings editor a toolkit
 * type with no typed schema (or the "Raw Json" view toggle) falls back to
 * (`../../lib/helpers/toolComponent.helpers.ts`'s `getToolComponent`).
 *
 * DISCLOSED REDESIGNS:
 *  - `ToolCustomHelpers.validationSettings` -> `../../lib/helpers/
 *    toolCustom.helpers.ts`'s already-landed `validationSettings` (A4b),
 *    that file's own doc comment names THIS component as its intended
 *    caller.
 *  - `useToolkitNameProp(type)` (baseline: internally self-fetching) ->
 *    this slice's `useToolkitNameProp(type, schemaOfTools)` (explicit
 *    `schemaOfTools` parameter — see that file's own doc comment), fed by
 *    this slice's `useGetCurrentToolkitSchemas()`.
 *  - `Field.CodeMirrorEditor` + `useLanguageLinter('json')` -> `shared/ui`'s
 *    `CodeMirrorEditor` + `../ToolBase/codeLanguageExtensions.ts`'s
 *    `getCodeLanguageExtensions('json')` (A4b's own port, real JSON syntax
 *    highlighting + a `jsonParseLinter()`).
 *  - `useToast().toastInfo(...)` (baseline's ONLY toast use — a copy-success
 *    confirmation) -> an optional injected `onCopy` callback, matching
 *    `shared/ui`'s own `StyledInputEnhancer`/`InputBase` `onCopy` convention
 *    (no toast infra exists in this app yet — see
 *    `OpenAPISchemaInput.tsx`'s own doc comment for the fuller citation of
 *    this established gap/resolution).
 *  - `StyledTooltip`/`CopyIcon` (`@/ComponentsLib/Tooltip`,
 *    `@/components/Icons/CopyIcon`) -> plain MUI `Tooltip` + `shared/ui`'s
 *    ported `CopyLinkIcon` (same glyph `CommonStringField.tsx`'s own
 *    clipboard button already uses for an identical "copy to clipboard"
 *    affordance).
 *
 * The two baseline `useEffect`s' bodies are each split into a pure helper
 * function (`computeValidationOutcome`/`computeRequiredPropertiesError`)
 * purely to stay under the §3.5 cyclomatic-complexity budget (12) — same
 * behaviour, same branch order, just callable (and independently testable)
 * outside the effect closure.
 */
export interface ToolCustomDetail {
  readonly index?: number | undefined;
  readonly id?: string | number | undefined;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly settings?: Readonly<Record<string, unknown>> | undefined;
  readonly type?: string | undefined;
}

export interface ToolCustomProps {
  readonly editToolDetail?: ToolCustomDetail;
  readonly setEditToolDetail?: (detail: Readonly<Record<string, unknown>>) => void;
  readonly setToolErrors: (updater: (prevState: Readonly<Record<string, boolean>>) => Record<string, boolean>) => void;
  readonly showValidation?: boolean;
  readonly schema?: ToolCustomSchema | undefined;
  readonly configurationSchema?: ToolCustomSchema | undefined;
  readonly editField?: (field: string, value: unknown, replace?: boolean) => void | Promise<void>;
  readonly needToCheckSection?: boolean;
  readonly onCopy?: (value: string) => void;
}

function buildInitialJson(editToolDetail: ToolCustomDetail, toolkitNameProp: string | undefined): string {
  const { name, description, settings, type } = editToolDetail;
  return toolkitNameProp
    ? JSON.stringify({ settings, type }, null, 2)
    : JSON.stringify({ name, description, settings, type }, null, 2);
}

interface ValidationOutcome {
  readonly error: string;
  readonly obj: Record<string, unknown> | undefined;
  /** `false` only when `obj` parsed but has no `settings` key — the baseline's own gate on writing `obj` back to `editToolDetail`/`editField` (`ToolCustom.jsx:110`: the whole write-back sits inside the `else` of `if (!obj.settings)`). */
  readonly hasSettings: boolean;
}

/** The baseline's first `useEffect` body (`ToolCustom.jsx:70-123`): parse, then validate against the resolved type schema. `obj` is `undefined` only on a JSON-parse failure (the `catch` branch). */
function computeValidationOutcome(input: {
  readonly jsonString: string;
  readonly toolkitNameProp: string | undefined;
  readonly editToolDetail: ToolCustomDetail;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly type: string | undefined;
  readonly nameIsRequired: boolean;
  readonly schemaOfTools: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined;
  readonly configurationSchema: ToolCustomSchema | undefined;
  readonly needToCheckSection: boolean;
}): ValidationOutcome {
  const { jsonString, toolkitNameProp, editToolDetail, name, description, type, nameIsRequired, schemaOfTools, configurationSchema, needToCheckSection } = input;
  try {
    const parsed = JSON.parse(jsonString) as Readonly<Record<string, unknown>>;
    const obj: Record<string, unknown> = toolkitNameProp
      ? { index: editToolDetail.index, id: editToolDetail.id, name, description, type, ...parsed }
      : { index: editToolDetail.index, id: editToolDetail.id, type, ...parsed };

    if (!obj.settings) {
      return { error: t('features.toolkits.toolCustom.settingsRequired', 'Toolkit must have settings field'), obj, hasSettings: false };
    }
    if (nameIsRequired && !(typeof obj.name === 'string' && obj.name.trim())) {
      return { error: t('features.toolkits.toolCustom.nameRequired', 'name is required'), obj, hasSettings: true };
    }

    const objType = typeof obj.type === 'string' ? obj.type : undefined;
    const realSchema = objType !== undefined ? schemaOfTools?.[objType] : undefined;
    if (!realSchema) return { error: '', obj, hasSettings: true };

    const result = validationSettings(obj.settings as Readonly<Record<string, unknown>>, realSchema, configurationSchema, needToCheckSection);
    return { error: result.isValid ? '' : result.errorMessage, obj, hasSettings: true };
  } catch {
    return { error: t('features.toolkits.toolCustom.invalidJson', 'Invalid JSON format'), obj: undefined, hasSettings: false };
  }
}

interface RequiredPropertiesInput {
  readonly settingsRecord: Readonly<Record<string, unknown>>;
  readonly schema: ToolCustomSchema | undefined;
  readonly configurationSchema: ToolCustomSchema | undefined;
  readonly needToCheckSection: boolean;
}

/**
 * `ToolCustomSchema['metadata']['sections'][key]`'s shape, read structurally
 * — `../../lib/helpers/toolCustom.helpers.ts`'s own `SchemaSection`/
 * `SchemaSubsection` (A4b) are deliberately NOT exported (that file's own
 * doc comment: "no current caller needs these three apart from
 * `ToolCustomSchema`"), so this is a local, structurally-identical
 * re-declaration rather than reaching into that module's internals.
 */
interface MetadataSubsection {
  readonly fields?: readonly string[];
}

interface MetadataSection {
  readonly required?: boolean;
  readonly subsections?: readonly MetadataSubsection[];
}

/** Top-level `schema.required`/`configurationSchema.required` half of `computeManualModeErrors`, split out purely to stay under the §3.5 complexity budget (12). */
function computeTopLevelRequiredErrors(settingsRecord: Readonly<Record<string, unknown>>, schema: ToolCustomSchema | undefined, configurationSchema: ToolCustomSchema | undefined): Record<string, boolean> {
  const errors: Record<string, boolean> = {};
  for (const prop of schema?.required ?? []) {
    const propertySchema = schema?.properties?.[prop] as { readonly type?: string } | undefined;
    errors[prop] = propertySchema?.type !== 'boolean' ? !settingsRecord[prop] : isNullOrUndefined(settingsRecord[prop]);
  }
  for (const prop of configurationSchema?.required ?? []) {
    errors[prop] = false;
  }
  return errors;
}

/** The subsection a required metadata section resolves to: the first one with at least one already-populated field, else its own first subsection. */
function resolveSelectedSubsection(section: MetadataSection, settingsRecord: Readonly<Record<string, unknown>>): MetadataSubsection | undefined {
  const subsections = section.subsections ?? [];
  const populated = subsections.find((subsection) => (subsection.fields ?? []).some((field) => !isNullOrUndefined(settingsRecord[field])));
  return populated ?? subsections[0];
}

/** Every required metadata section's own selected-subsection fields, flagged missing (falsy and not literal `0`). */
function computeSectionRequiredErrors(schema: ToolCustomSchema | undefined, settingsRecord: Readonly<Record<string, unknown>>): Record<string, boolean> {
  const errors: Record<string, boolean> = {};
  for (const section of Object.values(schema?.metadata?.sections ?? {})) {
    if (!section.required) continue;
    const selectedSubSection = resolveSelectedSubsection(section, settingsRecord);
    for (const prop of selectedSubSection?.fields ?? []) {
      errors[prop] = !settingsRecord[prop] && settingsRecord[prop] !== 0;
    }
  }
  return errors;
}

/** Sections-required branch of the baseline's second `useEffect` (manual/no-configuration-title mode): flags every top-level required field, plus every field of the first satisfied (or first, if none satisfied) subsection of each required metadata section. */
function computeManualModeErrors({ settingsRecord, schema, configurationSchema, needToCheckSection }: RequiredPropertiesInput): Record<string, boolean> {
  const topLevelErrors = computeTopLevelRequiredErrors(settingsRecord, schema, configurationSchema);
  if (!needToCheckSection) return topLevelErrors;
  return { ...topLevelErrors, ...computeSectionRequiredErrors(schema, settingsRecord) };
}

/** The `configuration_title` set-and-not-Manual branch of the baseline's second `useEffect`: the base schema's own required fields are trusted (a saved configuration covers them), only the attached `configurationSchema`'s required fields are actually checked. */
function computeConfigurationModeErrors({ settingsRecord, schema, configurationSchema }: RequiredPropertiesInput): Record<string, boolean> {
  const errors: Record<string, boolean> = {};
  for (const prop of schema?.required ?? []) {
    errors[prop] = false;
  }
  for (const prop of configurationSchema?.required ?? []) {
    const propertySchema = configurationSchema?.properties?.[prop] as { readonly type?: string } | undefined;
    errors[prop] = propertySchema?.type !== 'boolean' ? !settingsRecord[prop] : isNullOrUndefined(settingsRecord[prop]);
  }
  return errors;
}

function computeRequiredPropertiesError(input: RequiredPropertiesInput): Record<string, boolean> {
  const configurationTitle = input.settingsRecord['configuration_title'];
  const isManualMode = !configurationTitle || configurationTitle === ConfigurationMode.Manual;
  return isManualMode ? computeManualModeErrors(input) : computeConfigurationModeErrors(input);
}

export function ToolCustom({
  editToolDetail = {},
  setEditToolDetail = () => undefined,
  setToolErrors,
  showValidation: _showValidation = true,
  schema,
  configurationSchema,
  editField,
  needToCheckSection = true,
  onCopy,
}: ToolCustomProps): ReactNode {
  const { toolkitSchemas } = useGetCurrentToolkitSchemas();
  const { toolkitNameProp, schemaOfTools, nameIsRequired } = useToolkitNameProp(editToolDetail.type ?? '', toolkitSchemas);

  const [originalJsonString] = useState(() => buildInitialJson(editToolDetail, toolkitNameProp));
  const { name, description, settings, type } = editToolDetail;
  const [jsonString, setJsonString] = useState(() => buildInitialJson(editToolDetail, toolkitNameProp));
  const [error, setError] = useState('');
  const extensions = useMemo(() => getCodeLanguageExtensions('json'), []);

  const handleChange = useCallback((value: string) => setJsonString(value), []);

  const onClickCopy = useCallback(() => {
    void handleCopy(jsonString);
    onCopy?.(jsonString);
  }, [jsonString, onCopy]);

  useEffect(() => {
    const outcome = computeValidationOutcome({ jsonString, toolkitNameProp, editToolDetail, name, description, type, nameIsRequired, schemaOfTools, configurationSchema, needToCheckSection });
    setError(outcome.error);
    if (outcome.obj !== undefined && outcome.hasSettings && originalJsonString !== jsonString) {
      setEditToolDetail(outcome.obj);
      if (editField) {
        for (const key of Object.keys(outcome.obj)) {
          void editField(key, outcome.obj[key], true);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors the baseline's own dep array (`[jsonString]` only)
  }, [jsonString]);

  useEffect(() => {
    const requiredPropertiesError = computeRequiredPropertiesError({ settingsRecord: settings ?? {}, schema, configurationSchema, needToCheckSection });
    setToolErrors((prevState) => ({
      ...prevState,
      name: Boolean(nameIsRequired) && !name?.trim(),
      ...requiredPropertiesError,
    }));
  }, [configurationSchema, description, name, nameIsRequired, needToCheckSection, schema, setToolErrors, settings]);

  return (
    <Box sx={containerSx}>
      <FormControl
        sx={formControlSx}
        error={Boolean(error)}
      >
        <Typography
          variant="labelMedium"
          color="text.primary"
          component="div"
          sx={labelSx}
        >
          {t('features.toolkits.toolCustom.jsonLabel', 'JSON')}
        </Typography>
        <Tooltip
          title={t('features.toolkits.toolCustom.copyToClipboard', 'Copy to clipboard')}
          placement="top"
        >
          <IconButton
            sx={copyButtonSx}
            onClick={onClickCopy}
          >
            <CopyLinkIcon />
          </IconButton>
        </Tooltip>
        {error && <FormHelperText>{error}</FormHelperText>}

        <Box sx={editorContainerSx(Boolean(error))}>
          <CodeMirrorEditor
            value={jsonString}
            extensions={[...extensions]}
            height="100%"
            minHeight="100%"
            onChange={handleChange}
          />
        </Box>
      </FormControl>
    </Box>
  );
}

const containerSx: SxProps<Theme> = { height: 'calc(100% - 1.75rem)' };
const formControlSx: SxProps<Theme> = { width: '100%', height: '100%', position: 'relative' };
const labelSx: SxProps<Theme> = { display: 'block', margin: '1rem 0 0.5rem 0.75rem', fontWeight: '400' };
const copyButtonSx: SxProps<Theme> = { marginLeft: '1.25rem', position: 'absolute', top: '0.75rem', right: '0.5rem' };
const editorContainerSx = (hasError: boolean): SxProps<Theme> => (theme: Theme) => ({
  width: '100%',
  maxWidth: '100%',
  display: 'flex',
  height: `calc(100% - ${!hasError ? '2.875rem' : '4.25rem'})`,
  overflow: 'auto',
  flexDirection: 'column',
  border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
  boxSizing: 'border-box',
  borderRadius: theme.vars.shape.radiusMd,
});
