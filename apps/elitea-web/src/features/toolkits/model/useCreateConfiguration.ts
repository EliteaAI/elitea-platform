import { useCallback, useMemo, useState } from 'react';

import { createConfiguration, testConfigurationConnection } from '../api/configurations';
import type { ConfigurationWire, TestConnectionResult } from '../api/configurations';
import { toolkitFormErrorMessage } from '../lib/errorMessage';

/**
 * Local duplicate of `features/agents/model/useCreateConfiguration.ts`
 * (`no-sideways-features` forbids importing it) — both port the same
 * baseline, `apps/elitea-ui/src/hooks/application/useCreateConfiguration.jsx`,
 * used from `ToolkitForm.tsx`/`ToolkitsOperationButtons.tsx` (this slice's
 * `ToolkitForm.jsx:382-392`'s call site) to create a NEW credential
 * ("configuration") inline while editing/creating a toolkit — not a general
 * credentials-management hook (`features/credentials`' territory, which
 * this file cannot import).
 *
 * Same three disclosed redesigns as the agents copy (not re-litigated here,
 * see that file's own doc comment for the full rationale):
 *  1. `McpAuthHelpers.getAccessToken`/`CredentialErrorHelpers.
 *     extractInformationFromCredentialError` -> injected `getAccessToken`/
 *     `extractCredentialError` props, degrading gracefully when omitted.
 *  2. `projectId` (baseline: resolved from `configuration.configuration_title`)
 *     is a plain required input.
 *  3. No `useToast` — structured state, caller renders it.
 */

/** Not exported — no consumer outside this file needs it yet (knip: unused-export discipline). */
interface ConfigSchemaPropertyDescriptor {
  readonly type?: string;
  readonly [key: string]: unknown;
}

export interface ConfigurationTypeSchema {
  readonly type?: string;
  readonly title?: string;
  readonly config_schema?: {
    readonly properties?: {
      readonly data?: {
        readonly properties?: Readonly<Record<string, ConfigSchemaPropertyDescriptor>>;
        readonly required?: readonly string[];
      };
    };
  };
}

function findSchema(
  configurationsAsSchema: readonly ConfigurationTypeSchema[] | undefined,
  type: string,
): ConfigurationTypeSchema | undefined {
  return (
    configurationsAsSchema?.find((item) => item.type === type) ??
    configurationsAsSchema?.find((item) => item.title === type)
  );
}

function resolveTitle(settings: Readonly<Record<string, unknown>>, configurationName: string | undefined, type: string): string {
  const eliteaTitle = settings.elitea_title;
  const titleValue = typeof eliteaTitle === 'string' && eliteaTitle !== '' ? eliteaTitle : configurationName;
  if (titleValue !== undefined && titleValue.trim() !== '') return titleValue;
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
  return `${type}_${timestamp}`;
}

/** Baseline `getRequestBody` (`useCreateConfiguration.jsx:17-63`), ported verbatim. */
export function buildConfigurationRequestBody(input: {
  readonly type: string;
  readonly configurationKeys: readonly string[];
  readonly settings: Readonly<Record<string, unknown>>;
  readonly configurationName: string | undefined;
  readonly configurationsAsSchema: readonly ConfigurationTypeSchema[] | undefined;
}): { readonly elitea_title: string; readonly label: string; readonly type: string; readonly data: Record<string, unknown> } {
  const { type, configurationKeys, settings, configurationName, configurationsAsSchema } = input;
  const schema = findSchema(configurationsAsSchema, type);
  const dataProperties = schema?.config_schema?.properties?.data?.properties ?? {};
  const requiredFields = schema?.config_schema?.properties?.data?.required ?? [];

  const titleValue = resolveTitle(settings, configurationName, type);
  const data: Record<string, unknown> = {};
  configurationKeys.forEach((key) => {
    if (settings[key] !== undefined) data[key] = settings[key];
  });
  requiredFields.forEach((fieldName) => {
    if (dataProperties[fieldName]?.type === 'boolean' && !(fieldName in data)) {
      data[fieldName] = settings[fieldName] !== undefined ? settings[fieldName] : false;
    }
  });

  const label = settings.label;
  return {
    elitea_title: titleValue,
    label: typeof label === 'string' ? label : '',
    type,
    data,
  };
}

export interface UseCreateConfigurationInput {
  readonly type: string;
  readonly configurationName: string | undefined;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly configurationErrors: Readonly<Record<string, boolean>>;
  readonly configurationsAsSchema: readonly ConfigurationTypeSchema[] | undefined;
  readonly projectId: string;
  /** Credential-scoped OAuth token lookup key, forwarded verbatim to `getAccessToken`/`onConfigAuthRequired`. */
  readonly oauthTokenKey?: string;
  readonly getAccessToken?: (tokenKey: string) => string | undefined;
  readonly onToolsDiscovered?: (tools: readonly unknown[]) => void;
  readonly onConfigAuthRequired?: (authData: unknown, discoveryEndpoint: string, oauthTokenKey: string | undefined) => void;
}

export interface UseCreateConfigurationResult {
  readonly onTestConnection: () => Promise<boolean>;
  readonly onCreateConfiguration: () => Promise<ConfigurationWire | undefined>;
  readonly isTestingConnection: boolean;
  readonly isCreatingConfiguration: boolean;
  readonly testConnectionError: string | undefined;
  readonly createError: unknown;
  readonly createErrorMessage: string | undefined;
}

/** `onTestConnection`'s error gate (`useCreateConfiguration.jsx:130-136`): everything except the configuration-name field blocks a connection test. */
function hasCriticalErrorsForTest(configurationErrors: Readonly<Record<string, boolean>>): boolean {
  return Object.entries(configurationErrors).some(([key, hasError]) => hasError && key !== 'configurationName');
}

/** `onCreateConfiguration`'s error gate (`useCreateConfiguration.jsx:231-243`): a boolean-typed field's error never blocks create. */
function hasBlockingErrorsForCreate(
  configurationErrors: Readonly<Record<string, boolean>>,
  type: string,
  configurationsAsSchema: readonly ConfigurationTypeSchema[] | undefined,
): boolean {
  const dataProperties = findSchema(configurationsAsSchema, type)?.config_schema?.properties?.data?.properties ?? {};
  return Object.entries(configurationErrors).some(([key, hasError]) => hasError && dataProperties[key]?.type !== 'boolean');
}

/** Split out of `onTestConnection` purely to keep its cyclomatic complexity under the oxlint budget (12). */
function withAccessToken(
  input: UseCreateConfigurationInput,
  data: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...data };
  const discoveryEndpoint = input.settings.oauth_discovery_endpoint;
  if (typeof discoveryEndpoint === 'string' && input.getAccessToken !== undefined) {
    const token = input.getAccessToken(input.oauthTokenKey ?? discoveryEndpoint);
    if (token !== undefined) body.access_token = token;
  }
  return body;
}

/** Split out of `onTestConnection` purely to keep its cyclomatic complexity under the oxlint budget (12) — the baseline's own "Config OAuth: backend returned requires_authorization" branch. */
function isAuthRequiredError(caught: unknown): caught is { readonly requires_authorization: true } {
  return (
    typeof caught === 'object' &&
    caught !== null &&
    'requires_authorization' in caught &&
    (caught as { requires_authorization?: unknown }).requires_authorization === true
  );
}

export function useCreateConfiguration(input: UseCreateConfigurationInput): UseCreateConfigurationResult {
  const { type, configurationsAsSchema } = input;

  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isCreatingConfiguration, setIsCreatingConfiguration] = useState(false);
  const [testConnectionError, setTestConnectionError] = useState<string | undefined>(undefined);
  const [createError, setCreateError] = useState<unknown>(undefined);

  const configurationKeys = useMemo(() => {
    const schema = findSchema(configurationsAsSchema, type);
    return Object.keys(schema?.config_schema?.properties?.data?.properties ?? {});
  }, [configurationsAsSchema, type]);

  /**
   * `input` is read via `input.field` throughout both callbacks below
   * (rather than destructured into 10 separate dependency-array entries)
   * purely to stay under this codebase's `hook-deps` budget (§3.5, 8
   * entries — `scripts/check-budgets.mjs`); `input` is a plain object the
   * caller constructs fresh per render anyway (form state).
   */
  const onTestConnection = useCallback(async (): Promise<boolean> => {
    if (hasCriticalErrorsForTest(input.configurationErrors)) {
      return false;
    }
    setIsTestingConnection(true);
    setTestConnectionError(undefined);
    try {
      const body = buildConfigurationRequestBody({
        type: input.type,
        configurationKeys,
        settings: input.settings,
        configurationName: input.configurationName ?? 'test-connection',
        configurationsAsSchema: input.configurationsAsSchema,
      });
      const testConnectionBody = withAccessToken(input, body.data);

      const result: TestConnectionResult = await testConfigurationConnection(input.projectId, input.type, testConnectionBody);
      if (Array.isArray(result.tools)) {
        input.onToolsDiscovered?.(result.tools);
      }
      return true;
    } catch (caught) {
      if (isAuthRequiredError(caught)) {
        const discoveryEndpoint = input.settings.oauth_discovery_endpoint;
        input.onConfigAuthRequired?.(caught, typeof discoveryEndpoint === 'string' ? discoveryEndpoint : '', input.oauthTokenKey);
        return false;
      }
      setTestConnectionError(toolkitFormErrorMessage(caught));
      return false;
    } finally {
      setIsTestingConnection(false);
    }
  }, [input, configurationKeys]);

  const onCreateConfiguration = useCallback(async (): Promise<ConfigurationWire | undefined> => {
    if (hasBlockingErrorsForCreate(input.configurationErrors, input.type, input.configurationsAsSchema)) {
      return undefined;
    }
    setIsCreatingConfiguration(true);
    setCreateError(undefined);
    try {
      const body = buildConfigurationRequestBody({
        type: input.type,
        configurationKeys,
        settings: input.settings,
        configurationName: input.configurationName,
        configurationsAsSchema: input.configurationsAsSchema,
      });
      return await createConfiguration(input.projectId, body);
    } catch (caught) {
      setCreateError(caught);
      return undefined;
    } finally {
      setIsCreatingConfiguration(false);
    }
  }, [input, configurationKeys]);

  return {
    onTestConnection,
    onCreateConfiguration,
    isTestingConnection,
    isCreatingConfiguration,
    testConnectionError,
    createError,
    createErrorMessage: createError === undefined ? undefined : toolkitFormErrorMessage(createError),
  };
}
