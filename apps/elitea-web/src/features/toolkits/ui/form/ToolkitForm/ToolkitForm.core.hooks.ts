import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';
import { ToolkitViewOptions } from '@/shared/lib/enums';

import { getToolComponent } from '../../../lib/helpers/toolComponent.helpers';
import type { ToolFormComponent } from '../../../lib/helpers/toolComponent.helpers';
import { convertToolkitSchema } from '../../../lib/helpers/toolkitSchema.helpers';
import type { RawToolkitTypeSchema } from '../../../lib/helpers/toolkitSchema.helpers';
import { useGetCurrentToolkitSchemas } from '../../../lib/hooks/useGetCurrentToolkitSchemas.hooks';
import { useToolkitNameProp } from '../../../lib/hooks/useToolkitNameProp.hooks';

import { applyAutoSelectFormReset, resolveOutOfBandFieldSync, updateDetailByPath } from './ToolkitForm.helpers';
import type { ResolvedToolkitFormProps, ToolkitConfigurationState } from './ToolkitForm.types';

/**
 * State declarations, schema resolution, and `editField` — the first half
 * of `useToolkitFormState`'s baseline logic (`ToolkitForm.jsx`, roughly
 * lines 1-350). Split out of `ToolkitForm.hooks.ts` (which composes this
 * with `ToolkitForm.configuration.hooks.ts`'s `useToolkitFormConfiguration`)
 * purely to stay under the §3.5 400-line-per-file / complexity-12 budgets.
 */
export type EditFieldFn = (field: string, value: unknown, replace?: boolean, options?: { readonly isAutoSelect?: boolean }) => Promise<void>;

export interface CoreState {
  readonly view: string;
  readonly setView: Dispatch<SetStateAction<string>>;
  readonly onManualViewChange: (view: string) => void;
  readonly showValidation: boolean;
  readonly setShowValidation: Dispatch<SetStateAction<boolean>>;
  readonly toolErrors: Record<string, boolean>;
  readonly setToolErrors: Dispatch<SetStateAction<Record<string, boolean>>>;
  readonly serverToolErrors: Record<string, string | undefined>;
  readonly setServerToolErrors: Dispatch<SetStateAction<Record<string, string | undefined>>>;
  readonly configuration: ToolkitConfigurationState;
  readonly setConfiguration: Dispatch<SetStateAction<ToolkitConfigurationState>>;
  readonly configurationErrors: Record<string, boolean>;
  readonly setConfigurationErrors: Dispatch<SetStateAction<Record<string, boolean>>>;
  readonly configurationName: string;
  readonly setConfigurationName: Dispatch<SetStateAction<string>>;
  readonly toolkitSchemas: ToolkitTypeSchemaMap | undefined;
  readonly isFetching: boolean;
  readonly toolType: string;
  readonly effectiveToolSchema: RawToolkitTypeSchema | undefined;
  readonly ToolComponent: ToolFormComponent | undefined;
  readonly isValidSchema: boolean;
  readonly nameIsRequired: boolean;
  readonly hasErrors: boolean;
  readonly mergedToolErrors: Record<string, boolean>;
  readonly editField: EditFieldFn;
}

export function useToolkitFormCore(props: ResolvedToolkitFormProps): CoreState {
  const { editToolDetail, onChangeToolDetail, isMCP, onValidationStateChange, formValues, onSetFormField, onMcpScopesChanged, forceCustomView, onResetForm } = props;

  const hasSetViewManually = useRef(false);
  const [view, setView] = useState<string>(ToolkitViewOptions.Form);
  const [showValidation, setShowValidation] = useState(false);
  const [toolErrors, setToolErrors] = useState<Record<string, boolean>>({});
  const [serverToolErrors, setServerToolErrors] = useState<Record<string, string | undefined>>({});
  const [configurationErrors, setConfigurationErrors] = useState<Record<string, boolean>>({});
  const [configurationName, setConfigurationName] = useState('');
  const [configuration, setConfiguration] = useState<ToolkitConfigurationState>({
    elitea_title: (editToolDetail.settings?.elitea_title as string | undefined) ?? '',
    private: editToolDetail.settings?.private as boolean | undefined,
  });

  const isMcpType = editToolDetail.type === 'mcp';
  const { toolkitSchemas, isFetching } = useGetCurrentToolkitSchemas({ isMCP: Boolean(isMCP) && !isMcpType });

  const toolType = editToolDetail.type ?? '';

  const toolSchema = useMemo<RawToolkitTypeSchema | undefined>(
    // `convertToolkitSchema`'s return type (`ConvertedToolkitSchema` — `properties` required, not optional)
    // and this file's own `RawToolkitTypeSchema` (`properties` optional) describe the same
    // JSON-Schema-shaped object from two different, independently-typed modules; the cast
    // documents that, rather than a real behavioural difference.
    () => (editToolDetail.schema ?? convertToolkitSchema(toolkitSchemas?.[toolType])) as RawToolkitTypeSchema,
    [editToolDetail.schema, toolkitSchemas, toolType],
  );
  const effectiveToolSchema = toolSchema;

  const ToolComponent = useMemo(() => {
    const useJsonView = forceCustomView || view === ToolkitViewOptions.Json;
    if (useJsonView) return undefined;
    // `RawToolkitTypeSchema`'s only NAMED properties are `properties`/`required`/`$defs`
    // (everything else lives on its index signature) — none named `type`, so
    // it fails TS's "weak type" common-property check against
    // `getToolComponent`'s all-optional `ToolComponentSchema` (`{type?:
    // unknown}`) even though the index signature covers a real `.type` key
    // at runtime. An explicit two-step cast documents that mismatch instead
    // of silently loosening `getToolComponent`'s own parameter type.
    return getToolComponent(toolType, effectiveToolSchema as unknown as { readonly type?: unknown } | undefined);
  }, [effectiveToolSchema, forceCustomView, view, toolType]);

  const { nameIsRequired } = useToolkitNameProp(toolType, toolkitSchemas);
  const nameIsBlank = !editToolDetail.name?.trim();
  const computedNameError = nameIsRequired && nameIsBlank;
  const mergedToolErrors = useMemo(() => ({ ...toolErrors, ...serverToolErrors, name: computedNameError }), [toolErrors, serverToolErrors, computedNameError]);
  const hasErrors = useMemo(() => Object.values(mergedToolErrors).some(Boolean), [mergedToolErrors]);
  const triggerValidation = useCallback(() => setShowValidation(true), []);

  useEffect(() => {
    onValidationStateChange?.({ hasErrors, triggerValidation });
  }, [hasErrors, triggerValidation, onValidationStateChange]);

  const editField: EditFieldFn = useCallback(
    async (field, value, replace, options) => {
      const isNameOrDescription = field === 'name' || field === 'description';
      if (isNameOrDescription || toolType === 'custom') {
        await onSetFormField?.(field, value);
      }
      if (isMcpType && field === 'settings.scopes') {
        const settings = formValues.settings as { readonly url?: string } | undefined;
        onMcpScopesChanged?.(settings?.url);
      }
      const fieldKey = field.includes('.') ? (field.split('.').pop() ?? field) : field;
      setToolErrors((prev) => (fieldKey in prev ? Object.fromEntries(Object.entries(prev).filter(([key]) => key !== fieldKey)) : prev));
      setServerToolErrors((prev) => (fieldKey in prev ? Object.fromEntries(Object.entries(prev).filter(([key]) => key !== fieldKey)) : prev));
      onChangeToolDetail((prevState) => updateDetailByPath(prevState ?? {}, field, value, replace), options);
      applyAutoSelectFormReset(options, formValues, field, value, onResetForm);
    },
    [onChangeToolDetail, onSetFormField, toolType, isMcpType, onMcpScopesChanged, formValues, onResetForm],
  );

  const isValidSchema = useMemo(() => Object.keys(effectiveToolSchema ?? {}).length > 0, [effectiveToolSchema]);

  useEffect(() => {
    if (!isValidSchema) {
      setView((prev) => (prev !== ToolkitViewOptions.Json ? ToolkitViewOptions.Json : prev));
    } else if (!hasSetViewManually.current) {
      setView(ToolkitViewOptions.Form);
    }
  }, [isValidSchema, toolType]);

  useEffect(() => {
    for (const sync of resolveOutOfBandFieldSync(editToolDetail, formValues)) {
      void onSetFormField?.(sync.field, sync.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors the baseline's own dep array (`[editToolDetail]` only)
  }, [editToolDetail]);

  const onManualViewChange = useCallback((newView: string) => {
    setView(newView);
    hasSetViewManually.current = true;
  }, []);

  return {
    view,
    setView,
    onManualViewChange,
    showValidation,
    setShowValidation,
    toolErrors,
    setToolErrors,
    serverToolErrors,
    setServerToolErrors,
    configuration,
    setConfiguration,
    configurationErrors,
    setConfigurationErrors,
    configurationName,
    setConfigurationName,
    toolkitSchemas,
    isFetching,
    toolType,
    effectiveToolSchema,
    ToolComponent,
    isValidSchema,
    nameIsRequired,
    hasErrors,
    mergedToolErrors,
    editField,
  };
}
