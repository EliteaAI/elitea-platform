/**
 * The provider dialog's field model — which fields each provider type has, and
 * which of them are secret.
 *
 * Split from the dialog for the reason `./adminMcpServerForm.ts` is: the shape
 * of a provider is data, the dialog is layout, and a per-provider `switch`
 * inside JSX is where a field gets added for one provider and forgotten for
 * another.
 *
 * ## The field names are the gateway's, not this form's
 *
 * Every key here is read by `services/elitea-llm-gateway`'s `credentialData`
 * struct. A field renamed for readability would be written into the row, ignored
 * by the gateway, and the credential would resolve without it — an Azure
 * credential silently losing its api-version, say. The labels are for people;
 * the keys are a contract.
 */
import { t } from '@/shared/i18n';

import type { LlmProviderType } from './api/adminLlmProvidersApi';

export interface ProviderField {
  /** The `data` key. The gateway's name, never a prettier one. */
  readonly key: string;
  readonly label: string;
  /**
   * A secret is never read back, so on an edit an untouched secret field sends
   * nothing and the stored value survives.
   */
  readonly secret: boolean;
  readonly required: boolean;
  readonly placeholder?: string;
  /** Rendered as a multi-line field — a service-account document, not a token. */
  readonly multiline?: boolean;
}

/** `api_base` is common to every provider, and is never secret. */
function endpointField(required: boolean, placeholder: string): ProviderField {
  return {
    key: 'api_base',
    label: t('pages.admin.llmProviders.field.apiBase', 'Endpoint (api_base)'),
    secret: false,
    required,
    placeholder,
  };
}

function apiKeyField(required = true): ProviderField {
  return {
    key: 'api_key',
    label: t('pages.admin.llmProviders.field.apiKey', 'API key'),
    secret: true,
    required,
  };
}

/**
 * The fields each provider type carries.
 *
 * Derived from the gateway's `credentialData` and its per-provider resolution:
 * Azure and DIAL take an api-version, Bedrock takes AWS credentials and a
 * region, Vertex takes a Google service-account document and a project and
 * location, and the self-hosted providers take an endpoint and an optional key.
 */
const PROVIDER_FIELDS: Readonly<Record<LlmProviderType, readonly ProviderField[]>> = {
  open_ai: [apiKeyField(), endpointField(false, 'https://api.openai.com/v1')],
  anthropic: [apiKeyField(), endpointField(false, 'https://api.anthropic.com')],
  azure_open_ai: [
    apiKeyField(),
    endpointField(true, 'https://<resource>.openai.azure.com'),
    {
      key: 'api_version',
      label: t('pages.admin.llmProviders.field.apiVersion', 'API version'),
      secret: false,
      required: false,
      placeholder: '2024-02-01',
    },
  ],
  open_ai_azure: [
    apiKeyField(),
    endpointField(true, 'https://<resource>.openai.azure.com'),
    {
      key: 'api_version',
      label: t('pages.admin.llmProviders.field.apiVersion', 'API version'),
      secret: false,
      required: false,
      placeholder: '2024-02-01',
    },
  ],
  ai_dial: [
    apiKeyField(),
    endpointField(true, 'https://<dial-host>'),
    {
      key: 'api_version',
      label: t('pages.admin.llmProviders.field.apiVersion', 'API version'),
      secret: false,
      required: false,
    },
  ],
  amazon_bedrock: [
    {
      key: 'aws_access_key_id',
      label: t('pages.admin.llmProviders.field.awsAccessKeyId', 'AWS access key ID'),
      secret: false,
      required: true,
    },
    {
      key: 'aws_secret_access_key',
      label: t('pages.admin.llmProviders.field.awsSecretAccessKey', 'AWS secret access key'),
      secret: true,
      required: true,
    },
    {
      key: 'aws_region_name',
      label: t('pages.admin.llmProviders.field.awsRegion', 'AWS region'),
      secret: false,
      required: true,
      placeholder: 'us-east-1',
    },
  ],
  vertex_ai: [
    {
      key: 'vertex_project',
      label: t('pages.admin.llmProviders.field.vertexProject', 'Google Cloud project'),
      secret: false,
      required: true,
    },
    {
      key: 'vertex_location',
      label: t('pages.admin.llmProviders.field.vertexLocation', 'Location'),
      secret: false,
      required: true,
      placeholder: 'us-central1',
    },
    {
      key: 'vertex_credentials',
      label: t('pages.admin.llmProviders.field.vertexCredentials', 'Service account JSON'),
      secret: true,
      required: true,
      multiline: true,
    },
  ],
  // The self-hosted pair. The key is optional: an Ollama or vLLM deployment
  // behind a private network commonly has none, and requiring one would make
  // the form refuse a configuration that works.
  ollama: [endpointField(true, 'http://ollama:11434'), apiKeyField(false)],
  vllm: [endpointField(true, 'http://vllm:8000/v1'), apiKeyField(false)],
};

export function providerFields(type: LlmProviderType): readonly ProviderField[] {
  return PROVIDER_FIELDS[type];
}

/** Human labels for the type select. */
export function providerTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    open_ai: 'OpenAI',
    azure_open_ai: 'Azure OpenAI',
    open_ai_azure: 'Azure OpenAI (legacy naming)',
    ai_dial: 'EPAM DIAL',
    anthropic: 'Anthropic',
    ollama: 'Ollama',
    amazon_bedrock: 'Amazon Bedrock',
    vertex_ai: 'Google Vertex AI',
    vllm: 'vLLM',
  };
  return labels[type] ?? type;
}

/**
 * Which fields are missing, given what the operator typed.
 *
 * `editing` relaxes every SECRET field: on an edit a blank secret means "keep
 * the stored one", so requiring it would force an operator renaming a credential
 * to re-enter a key they cannot read back.
 */
export function missingProviderFields(
  type: LlmProviderType,
  values: Readonly<Record<string, string>>,
  editing: boolean,
): readonly string[] {
  return providerFields(type)
    .filter((field) => field.required && (field.secret ? !editing : true))
    .filter((field) => (values[field.key] ?? '').trim() === '')
    .map((field) => field.label);
}

/**
 * The `data` object to send.
 *
 * A blank SECRET field is OMITTED rather than sent as an empty string. That is
 * the difference between "keep the stored key" and "erase the stored key", and
 * the delegated update is partial, so an omitted key really does keep it.
 *
 * A blank NON-secret field is sent as the empty string, because clearing an
 * endpoint or an api-version is a thing an operator legitimately does and there
 * is no other way to express it.
 */
export function providerDataFor(
  type: LlmProviderType,
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const data: Record<string, string> = {};
  for (const field of providerFields(type)) {
    const value = (values[field.key] ?? '').trim();
    if (field.secret && value === '') continue;
    data[field.key] = value;
  }
  return data;
}
