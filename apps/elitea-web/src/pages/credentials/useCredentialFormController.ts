/**
 * pages/credentials/useCredentialFormController.ts — all state/mutation
 * orchestration for `CredentialForm.tsx`, split into its own file purely to
 * keep `CredentialForm`'s own render function under the §3.5
 * cyclomatic-complexity budget (≤12) — see that file's doc comment. Ported
 * behaviour from `apps/elitea-ui/src/pages/Credentials/CredentialForm.jsx`/
 * `hooks/credentials/{useCreateCredential,useUpdateCredential}.jsx`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import {
  extractInformationFromCredentialError,
  initialDataForSchema,
  useAvailableConfigurationsType,
  useConfigurationDetail,
  useCreateConfiguration,
  useDeleteConfiguration,
  useTestConfigurationConnection,
  useUpdateConfiguration,
} from '@/features/credentials';
import { t } from '@/shared/i18n';
import type { ConfigSchemaNode, ConfigurationTypeDescriptor } from '@/features/credentials';

export interface CredentialFormContext {
  readonly projectId: string;
  readonly personalProjectId?: string;
  readonly isTeamProject: boolean;
  readonly canUpdate: boolean;
  readonly canDelete: boolean;
}

export interface CredentialFormMode {
  readonly kind: 'create' | 'edit';
  readonly credentialType?: string;
  readonly configId?: string;
  /** `/settings/create-configuration`/`/settings/edit-configuration` (ROUTE-063..065): different title, category selector hidden. */
  readonly configurationMode?: boolean;
}

export interface CredentialFormPrefill {
  readonly name?: string;
  readonly id?: string;
  readonly section?: string;
}

export interface CredentialFormControllerProps {
  readonly context: CredentialFormContext;
  readonly mode: CredentialFormMode;
  readonly onSaved: () => void;
  readonly onDiscarded: () => void;
  readonly prefill?: CredentialFormPrefill;
  readonly onTypeChosen?: (type: string) => void;
}

function findTypeDescriptor(list: readonly ConfigurationTypeDescriptor[] | undefined, type: string | undefined): ConfigurationTypeDescriptor | undefined {
  if (!type) return undefined;
  return list?.find((item) => item.type === type);
}

/** `useCreateCredential.jsx`'s title fallback: `settings.elitea_title || \`${type}_${timestamp}\`` — same for update (`updated_configurartion_...`, baseline's own typo not reproduced here since this port shares one title builder for both paths; the value is a fallback default a user virtually always overrides). */
function buildTitle(eliteaTitle: string | undefined, type: string): string {
  if (eliteaTitle && eliteaTitle.trim() !== '') return eliteaTitle;
  return `${type}_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}`;
}

/** Maps a thrown `EliteaApiError` (see `shared/api/generated/mutator.ts`) onto the `{data:{message,field}}` shape `extractInformationFromCredentialError` expects. `unknown` in, since a caught value is never narrowed by TypeScript. */
function toCredentialApiError(error: unknown): { readonly data?: { readonly message?: unknown; readonly field?: unknown } } {
  if (typeof error !== 'object' || error === null || !('failure' in error)) return {};
  const failure = (error as { failure?: unknown }).failure;
  if (typeof failure !== 'object' || failure === null || !('body' in failure)) return {};
  const body = (failure as { body?: unknown }).body;
  if (typeof body !== 'object' || body === null) return {};
  const record = body as Record<string, unknown>;
  return { data: { message: record['error'] ?? record['message'], field: record['field'] } };
}

type SaveOutcome = { readonly status: 'ok' } | { readonly status: 'fieldErrors'; readonly errors: Readonly<Record<string, string>> } | { readonly status: 'genericError' };

interface PerformSaveParams {
  readonly mode: CredentialFormMode;
  readonly projectId: string;
  readonly type: string;
  readonly name: string;
  readonly shared: boolean;
  readonly data: Readonly<Record<string, unknown>>;
  readonly schemaProperties: Readonly<Record<string, ConfigSchemaNode>>;
  readonly createConfiguration: ReturnType<typeof useCreateConfiguration>;
  readonly updateConfiguration: ReturnType<typeof useUpdateConfiguration>;
}

/** The create-vs-update dispatch + error-mapping, isolated from the hook so its own complexity is measured separately (§3.5). */
async function performSave(params: PerformSaveParams): Promise<SaveOutcome> {
  const { mode, projectId, type, name, shared, data, schemaProperties, createConfiguration, updateConfiguration } = params;
  const body = { elitea_title: buildTitle(name, type), label: name, data, shared };
  try {
    if (mode.kind === 'edit' && mode.configId) {
      await updateConfiguration.mutateAsync({ projectId, configId: mode.configId, body });
    } else {
      await createConfiguration.mutateAsync({ projectId, body: { ...body, type } });
    }
    return { status: 'ok' };
  } catch (error) {
    const { newErrors } = extractInformationFromCredentialError({ error: toCredentialApiError(error), schemaProperties, settings: data });
    if (Object.keys(newErrors).length > 0) return { status: 'fieldErrors', errors: newErrors };
    return { status: 'genericError' };
  }
}

type TestOutcome = { readonly status: 'success' } | { readonly status: 'failure'; readonly message: string };

/** Split out of the hook body — one more condition there would push `useCredentialFormController` over the §3.5 complexity budget. */
function canSubmit(canUpdate: boolean, name: string, effectiveType: string | undefined, isSaving: boolean): boolean {
  return canUpdate && name.trim() !== '' && Boolean(effectiveType) && !isSaving;
}

/** Isolated for the same reason as `performSave`. */
async function performTestConnection(
  testConnection: ReturnType<typeof useTestConfigurationConnection>,
  projectId: string,
  configType: string,
  data: Readonly<Record<string, unknown>>,
): Promise<TestOutcome> {
  try {
    const result = await testConnection.mutateAsync({ projectId, configType, body: data });
    if (result.error) return { status: 'failure', message: result.error };
    return { status: 'success' };
  } catch {
    return { status: 'failure', message: t('credentials.form.testFailed', 'Connection test failed') };
  }
}

/** Seeds `name`/`shared`/`data` once the relevant query settles — split out of the hook body so the `useEffect` callback (a separate function scope) carries its own branches, not the hook's. */
function useFormSeeding(
  mode: CredentialFormMode,
  detailData: { elitea_title?: string; label?: string; shared?: boolean; data?: Readonly<Record<string, unknown>> } | undefined,
  dataSchema: ConfigSchemaNode | undefined,
  setName: Dispatch<SetStateAction<string>>,
  setShared: Dispatch<SetStateAction<boolean>>,
  setData: Dispatch<SetStateAction<Record<string, unknown>>>,
): void {
  useEffect(() => {
    if (mode.kind === 'edit') {
      if (!detailData) return;
      setName(detailData.elitea_title ?? detailData.label ?? '');
      setShared(detailData.shared ?? false);
      setData({ ...initialDataForSchema(dataSchema), ...detailData.data });
      return;
    }
    if (dataSchema) setData(initialDataForSchema(dataSchema));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seeds only when the loaded detail or the resolved type schema actually changes.
  }, [mode.kind, detailData, dataSchema]);
}

export function useCredentialFormController(props: CredentialFormControllerProps) {
  const { context, mode, onSaved, onDiscarded, prefill, onTypeChosen } = props;

  const [selectedType, setSelectedType] = useState<string | undefined>(mode.credentialType);
  const [name, setName] = useState(prefill?.name ?? '');
  const [shared, setShared] = useState(false);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [apiError, setApiError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'failure'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const availableTypes = useAvailableConfigurationsType(prefill?.section !== undefined ? { section: prefill.section } : {});
  const detail = useConfigurationDetail(context.projectId, mode.configId, { enabled: mode.kind === 'edit' });

  const effectiveType = mode.kind === 'edit' ? detail.data?.type : selectedType;
  const typeDescriptor = findTypeDescriptor(availableTypes.data, effectiveType);
  // The wire schema nests the actual configurable fields one level down, at
  // `config_schema.properties.data.properties.<field>` — the top-level
  // `config_schema.properties` object has exactly one member, `data`
  // (verified against `CredentialTypeSelector.tsx`'s identical unwrap and
  // `useMultiSectionConfigurations.js`'s `config_schema.properties.data
  // .metadata.hidden` read in the baseline).
  const dataSchema = typeDescriptor?.config_schema.properties?.['data'];
  // Memoized (not `?? {}` inline): a fresh `{}` every render would defeat
  // `save`'s `useCallback` memoization below (react-hooks/exhaustive-deps
  // correctly flags a dependency that "changes every render" as a real bug,
  // not a style nit — `save` would never actually stay referentially stable).
  const schemaProperties = useMemo(() => dataSchema?.properties ?? {}, [dataSchema]);

  useFormSeeding(mode, detail.data, dataSchema, setName, setShared, setData);

  const createConfiguration = useCreateConfiguration();
  const updateConfiguration = useUpdateConfiguration();
  const deleteConfiguration = useDeleteConfiguration();
  const testConnection = useTestConfigurationConnection();

  const isSaving = createConfiguration.isPending || updateConfiguration.isPending;
  const canSave = canSubmit(context.canUpdate, name, effectiveType, isSaving);

  // Collapses 3 separate `save`/`testConnectionAction` dependencies into 1
  // — keeps both `useCallback` dependency arrays within the §3.5 budget
  // (≤8 entries) without losing memoization correctness (this object is
  // itself re-derived only when one of the three fields actually changes).
  const formValues = useMemo(() => ({ name, shared, data }), [name, shared, data]);

  const chooseType = useCallback(
    (type: string) => {
      setSelectedType(type);
      onTypeChosen?.(type);
    },
    [onTypeChosen],
  );

  const setField = useCallback((fieldKey: string, value: unknown): void => {
    setData((prev) => ({ ...prev, [fieldKey]: value }));
  }, []);

  const save = useCallback(() => {
    if (!effectiveType) return;
    setApiError('');
    setFieldErrors({});
    void performSave({
      mode,
      projectId: context.projectId,
      type: effectiveType,
      name: formValues.name,
      shared: formValues.shared,
      data: formValues.data,
      schemaProperties,
      createConfiguration,
      updateConfiguration,
    }).then((outcome) => {
      if (outcome.status === 'ok') {
        onSaved();
      } else if (outcome.status === 'fieldErrors') {
        setFieldErrors(outcome.errors);
      } else {
        setApiError(t('credentials.form.saveFailed', 'Failed to save credential'));
      }
    });
  }, [effectiveType, mode, context.projectId, formValues, schemaProperties, createConfiguration, updateConfiguration, onSaved]);

  const testConnectionAction = useCallback(() => {
    if (!effectiveType) return;
    setTestResult('idle');
    void performTestConnection(testConnection, context.projectId, effectiveType, formValues.data).then((outcome) => {
      setTestResult(outcome.status);
      setTestMessage(outcome.status === 'failure' ? outcome.message : '');
    });
  }, [effectiveType, testConnection, context.projectId, formValues.data]);

  const remove = useCallback(() => {
    if (!mode.configId) return;
    deleteConfiguration.mutate({ projectId: context.projectId, configId: mode.configId }, { onSuccess: onDiscarded });
  }, [mode.configId, deleteConfiguration, context.projectId, onDiscarded]);

  return {
    availableTypes,
    effectiveType,
    typeDescriptor,
    schemaProperties,
    name,
    setName,
    shared,
    setShared,
    data,
    setField,
    apiError,
    fieldErrors,
    testResult,
    testMessage,
    isSaving,
    isTesting: testConnection.isPending,
    isDeleting: deleteConfiguration.isPending,
    canSave,
    chooseType,
    save,
    testConnection: testConnectionAction,
    remove,
  };
}
