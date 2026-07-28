import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo } from 'react';

import type { ConfigurationWire } from '../../../api/configurations';
import { useConfigurationsList } from '../../../api/useConfigurationsList';
import { parseValidationErrors } from '../../../lib/helpers/toolkitForm.helpers';
import { useConfigurationsAsSchema } from '../../../model/useConfigurationsAsSchema.hooks';
import { useCreateConfiguration } from '../../../model/useCreateConfiguration';

import { resolveCredentialReverts, resolveDisabledConfigFields, resolveIsLoading, resolveSupportsConfiguration } from './ToolkitForm.helpers';
import type { ResolvedToolkitFormProps, ToolkitConfigurationState } from './ToolkitForm.types';
import type { CoreState, EditFieldFn } from './ToolkitForm.core.hooks';

/**
 * The saved-configuration half of `useToolkitFormState`
 * (`ToolkitForm.jsx:353-500`, roughly) — split out of `ToolkitForm.hooks.ts`
 * purely to stay under the §3.5 400-line-per-file budget. Takes
 * `CoreState`'s already-resolved pieces (from `ToolkitForm.core.hooks.ts`)
 * rather than re-deriving them.
 */

/** `ToolkitForm.jsx:381-392`'s `onCreateConfiguration` + `onSaveConfiguration` chain: create the credential, then (when it carries a title) mirror it onto `editToolDetail.settings` via `editField`. */
function useWrappedCreateConfiguration(input: {
  readonly onCreateConfiguration: () => Promise<ConfigurationWire | undefined>;
  readonly editField: EditFieldFn;
  readonly editToolDetailSettings: Readonly<Record<string, unknown>> | undefined;
  readonly personalProjectId: string | number | undefined;
  readonly setConfiguration: Dispatch<SetStateAction<ToolkitConfigurationState>>;
}): () => Promise<boolean> {
  const { onCreateConfiguration, editField, editToolDetailSettings, personalProjectId, setConfiguration } = input;

  const onSaveConfiguration = useCallback(
    async (config: { readonly settings?: { readonly elitea_title?: string; readonly title?: string }; readonly title?: string; readonly project_id?: string | number }) => {
      const title = config.settings?.elitea_title ?? config.title ?? config.settings?.title;
      setConfiguration({ elitea_title: title, private: config.project_id === personalProjectId });
      if (config.title || config.settings?.title) {
        await editField('settings', { ...editToolDetailSettings, elitea_title: title, private: config.project_id === personalProjectId });
      }
    },
    [editField, editToolDetailSettings, personalProjectId, setConfiguration],
  );

  return useCallback(async () => {
    const created = await onCreateConfiguration();
    if (created) await onSaveConfiguration(created);
    return created !== undefined;
  }, [onCreateConfiguration, onSaveConfiguration]);
}

/** `ToolkitForm.jsx:394-417`'s `onRevertCredentials`: reverts every changed shared-credential settings field, then resets the local `configuration` reference state to the initial values. */
function useRevertCredentials(input: {
  readonly editToolDetailSettings: Readonly<Record<string, unknown>> | undefined;
  readonly formInitialValuesSettings: Readonly<Record<string, unknown>> | undefined;
  readonly editField: EditFieldFn;
  readonly setConfiguration: Dispatch<SetStateAction<ToolkitConfigurationState>>;
}): () => void {
  const { editToolDetailSettings, formInitialValuesSettings, editField, setConfiguration } = input;
  return useCallback(() => {
    const currentSettings = editToolDetailSettings ?? {};
    const initialSettings = formInitialValuesSettings ?? {};
    for (const revert of resolveCredentialReverts(currentSettings, initialSettings)) {
      void editField(revert.field, revert.value);
    }
    setConfiguration({ elitea_title: (initialSettings.elitea_title as string | undefined) ?? '', private: initialSettings.private as boolean | undefined });
  }, [editToolDetailSettings, formInitialValuesSettings, editField, setConfiguration]);
}

export interface ConfigurationState {
  readonly isCreatingConfiguration: boolean;
  readonly isTestingConnection: boolean;
  readonly onCreateConfiguration: () => Promise<boolean>;
  readonly onTestConnection: () => Promise<boolean>;
  readonly onRevertCredentials: () => void;
  readonly shouldShowDisabledConfigFields: boolean;
  readonly onCredentialReload: (options?: { readonly notReload?: boolean; readonly clearValidationError?: boolean; readonly key?: string; readonly credentialMessage?: string }) => void;
  readonly isLoading: boolean;
}

export function useToolkitFormConfiguration(props: ResolvedToolkitFormProps, core: CoreState): ConfigurationState {
  const { editToolDetail, isEditing, updateKey, revertCredentialsRef: externalRevertCredentialsRef, projectId, personalProjectId, formInitialValues, toolkitValidation, routeToolkitType, formValues, onSetFormField, getAccessToken, onConfigAuthRequired } = props;
  const { configuration, setConfiguration, editField, isFetching, toolkitSchemas, configurationErrors, setConfigurationErrors, setConfigurationName, setToolErrors, setShowValidation, setServerToolErrors } = core;

  const { configurationsAsSchema } = useConfigurationsAsSchema();
  const { data: configurationsListPage } = useConfigurationsList({ projectId: projectId ?? '', section: 'credentials' }, { enabled: projectId !== undefined });
  const integrations = useMemo(() => configurationsListPage?.items ?? [], [configurationsListPage]);
  const supportsConfiguration = useMemo(() => resolveSupportsConfiguration(integrations, core.toolType), [integrations, core.toolType]);
  const shouldShowDisabledConfigFields = useMemo(() => resolveDisabledConfigFields(configuration, isEditing, supportsConfiguration), [configuration, isEditing, supportsConfiguration]);

  const { onCreateConfiguration, onTestConnection, isCreatingConfiguration, isTestingConnection } = useCreateConfiguration({
    type: editToolDetail.type ?? '',
    configurationName: core.configurationName,
    settings: editToolDetail.settings ?? {},
    configurationErrors,
    configurationsAsSchema,
    projectId: projectId ?? '',
    ...(getAccessToken !== undefined ? { getAccessToken } : {}),
    ...(onConfigAuthRequired !== undefined ? { onConfigAuthRequired } : {}),
  });

  const wrappedOnCreateConfiguration = useWrappedCreateConfiguration({
    onCreateConfiguration,
    editField,
    editToolDetailSettings: editToolDetail.settings,
    personalProjectId,
    setConfiguration,
  });

  const onRevertCredentials = useRevertCredentials({
    editToolDetailSettings: editToolDetail.settings,
    formInitialValuesSettings: formInitialValues?.settings as Record<string, unknown> | undefined,
    editField,
    setConfiguration,
  });

  useEffect(() => {
    if (externalRevertCredentialsRef) externalRevertCredentialsRef.current = onRevertCredentials;
  }, [externalRevertCredentialsRef, onRevertCredentials]);

  useEffect(() => {
    setShowValidation(false);
    setToolErrors({});
    setConfigurationErrors({});
    setConfigurationName('');
    setConfiguration({ elitea_title: (editToolDetail.settings?.elitea_title as string | undefined) ?? '', private: (editToolDetail.settings?.private as boolean | undefined) ?? false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors the baseline's own dep array (`[updateKey]` only)
  }, [updateKey]);

  const onCredentialReload = useCallback(
    (options: { readonly notReload?: boolean; readonly clearValidationError?: boolean; readonly key?: string; readonly credentialMessage?: string } = {}) => {
      const { notReload, clearValidationError, key, credentialMessage } = options;
      if (!notReload) {
        toolkitValidation?.refetch();
        return;
      }
      if (!key) return;
      setServerToolErrors((prev) => ({ ...prev, [key]: clearValidationError ? undefined : credentialMessage }));
    },
    [toolkitValidation, setServerToolErrors],
  );

  useEffect(() => {
    if (!toolkitValidation?.isError) {
      setServerToolErrors({});
      return;
    }
    const validationErrors = parseValidationErrors(toolkitValidation.error?.data?.settings_errors ?? []);
    if (Object.keys(validationErrors).length > 0) {
      setServerToolErrors(validationErrors);
      setShowValidation(true);
    }
  }, [toolkitValidation, setServerToolErrors, setShowValidation]);

  useEffect(() => {
    if (formValues.type !== routeToolkitType && !formValues.type && routeToolkitType) {
      void onSetFormField?.('type', routeToolkitType);
    }
  }, [routeToolkitType, formValues.type, onSetFormField]);

  const isLoading = resolveIsLoading(isFetching, toolkitSchemas !== undefined, editToolDetail.isLoadingConfigurations);

  return {
    isCreatingConfiguration,
    isTestingConnection,
    onCreateConfiguration: wrappedOnCreateConfiguration,
    onTestConnection,
    onRevertCredentials,
    shouldShowDisabledConfigFields,
    onCredentialReload,
    isLoading,
  };
}
