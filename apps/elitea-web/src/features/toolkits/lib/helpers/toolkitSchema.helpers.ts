/**
 * Ported verbatim (structure and behaviour) from
 * `apps/elitea-ui/src/common/toolkitSchemaUtils.js` (164 lines) —
 * `convertToolkitSchema`, used by `ToolkitForm.tsx` (baseline
 * `ToolkitForm.jsx:124-126`: `editToolDetail?.schema ||
 * convertToolkitSchema(toolkitSchemas?.[toolType])`) to reshape a raw
 * toolkit-type JSON-Schema (Pydantic v2, `json_schema_extra`-flattened) into
 * the property-categorised shape `ToolBaseProperty.tsx` (a sibling A4
 * sub-unit's own settings-form renderer) branches on: LLM/embedding/image-
 * generation model references, toolkit/agent/pipeline references, and
 * `$defs`-backed "configuration" references, each tagged with a synthetic
 * `type` (`'llm_model'`/`'toolkit_reference'`/`'configuration'`/etc.)
 * alongside the ordinary properties. Pure, dependency-free — no cross-
 * feature/cross-slice imports needed, so this is a faithful, complete port
 * rather than a redesign.
 */

export interface JsonSchemaExtraShape {
  readonly json_schema_extra?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

/** Flattens `json_schema_extra` (Pydantic v2's UI-metadata carrier: `ui_component`/`configuration`/`secret`/etc.) into each property directly. */
function flattenJsonSchemaExtra(properties: Readonly<Record<string, unknown>> | undefined): Record<string, Record<string, unknown>> {
  if (!properties) return {};

  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value && typeof value === 'object') {
      const { json_schema_extra, ...restValue } = value as JsonSchemaExtraShape;
      result[key] = { ...restValue, ...json_schema_extra };
    } else {
      result[key] = value as Record<string, unknown>;
    }
  }
  return result;
}

interface AnyOfRefEntry {
  readonly $ref?: string;
}

function refDefKey(ref: string | undefined): string {
  return ref?.replace('#/$defs/', '') ?? '';
}

/** True when a property references a `$defs` entry, either directly (`$ref`) or through an `anyOf` branch (the `Optional[...]` JSON-Schema shape). */
function findConfigDefKey(property: Readonly<Record<string, unknown>>, configKeys: readonly string[]): string {
  const anyOf = property.anyOf;
  if (Array.isArray(anyOf)) {
    const match = (anyOf as readonly AnyOfRefEntry[]).find((item) => item.$ref !== undefined && configKeys.includes(refDefKey(item.$ref)));
    return refDefKey(match?.$ref);
  }
  return refDefKey(property.$ref as string | undefined);
}

function isConfigProperty(property: Readonly<Record<string, unknown>>, configKeys: readonly string[]): boolean {
  return configKeys.includes(findConfigDefKey(property, configKeys));
}

export interface ConvertedToolkitSchema {
  readonly required?: readonly string[] | undefined;
  readonly properties: Record<string, Record<string, unknown>>;
  readonly [key: string]: unknown;
}

type PropertyBag = Record<string, Record<string, unknown>>;
type DefsBag = Readonly<Record<string, { readonly metadata?: { readonly section?: string } } | undefined>>;

/** Extracted from `categorizeProperties` purely to keep its own cyclomatic complexity under the R-lint budget (each of these key-selection predicates was previously an inline `.filter()` in that one function). */
function selectPropertyKeys(
  properties: Readonly<PropertyBag>,
  defs: DefsBag,
): {
  readonly llmModelProps: readonly string[];
  readonly embeddingModelProps: readonly string[];
  readonly imageGenerationModelProps: readonly string[];
  readonly toolkitProps: readonly string[];
  readonly agentProps: readonly string[];
  readonly pipelineProps: readonly string[];
  readonly configProps: readonly string[];
  readonly nonConfigProps: readonly string[];
} {
  const configKeys = Object.keys(defs);
  const keys = Object.keys(properties);

  const llmModelProps = keys.filter((key) => properties[key]?.configuration_model === 'llm' || key === 'llm_model');
  const embeddingModelProps = keys.filter((key) => properties[key]?.configuration_model === 'embedding' || key === 'embedding_model');
  const imageGenerationModelProps = keys.filter((key) => properties[key]?.configuration_model === 'image_generation' || key === 'image_generation_model');
  const toolkitProps = keys.filter((key) => properties[key]?.toolkit_types !== undefined);
  const agentProps = keys.filter((key) => properties[key]?.agent_tags !== undefined);
  const pipelineProps = keys.filter((key) => properties[key]?.pipeline_tags !== undefined);
  const configProps = keys.filter((key) => properties[key] !== undefined && isConfigProperty(properties[key], configKeys));
  const claimed = new Set([...configProps, ...llmModelProps, ...embeddingModelProps, ...imageGenerationModelProps, ...toolkitProps, ...agentProps, ...pipelineProps]);
  const nonConfigProps = keys.filter((key) => !claimed.has(key));

  return { llmModelProps, embeddingModelProps, imageGenerationModelProps, toolkitProps, agentProps, pipelineProps, configProps, nonConfigProps };
}

function buildNormalProperties(propKeys: readonly string[], properties: Readonly<PropertyBag>): PropertyBag {
  const result: PropertyBag = {};
  for (const key of propKeys) result[key] = { ...properties[key] };
  return result;
}

/** Shared by the three model-reference categories (llm/embedding/image-generation) — each only differs by its synthetic `type` tag. */
function buildModelReferenceProperties(propKeys: readonly string[], properties: Readonly<PropertyBag>, type: string): PropertyBag {
  const result: PropertyBag = {};
  for (const key of propKeys) result[key] = { ...properties[key], type };
  return result;
}

function buildToolkitReferenceProperties(propKeys: readonly string[], properties: Readonly<PropertyBag>): PropertyBag {
  const result: PropertyBag = {};
  for (const key of propKeys) {
    const prop = properties[key] ?? {};
    const toolkitFilter: Record<string, unknown> = {};
    if (prop.toolkit_types !== undefined) toolkitFilter.toolkit_type = prop.toolkit_types;
    if (prop.application) toolkitFilter.application = true;
    result[key] = {
      ...prop,
      originalType: prop.type,
      type: 'toolkit_reference',
      ...(Object.keys(toolkitFilter).length > 0 ? { toolkit_filter: toolkitFilter } : {}),
    };
  }
  return result;
}

function buildAgentReferenceProperties(propKeys: readonly string[], properties: Readonly<PropertyBag>): PropertyBag {
  const result: PropertyBag = {};
  for (const key of propKeys) {
    const prop = properties[key] ?? {};
    result[key] = {
      ...prop,
      originalType: prop.type,
      type: 'agent_reference',
      ...(prop.agent_tags !== undefined ? { agent_filter: { agent_tags: prop.agent_tags } } : {}),
    };
  }
  return result;
}

function buildPipelineReferenceProperties(propKeys: readonly string[], properties: Readonly<PropertyBag>): PropertyBag {
  const result: PropertyBag = {};
  for (const key of propKeys) {
    const prop = properties[key] ?? {};
    result[key] = {
      ...prop,
      originalType: prop.type,
      type: 'pipeline_reference',
      ...(prop.pipeline_tags !== undefined ? { pipeline_filter: { pipeline_tags: prop.pipeline_tags } } : {}),
    };
  }
  return result;
}

function buildConfigProperties(propKeys: readonly string[], properties: Readonly<PropertyBag>, defs: DefsBag, configKeys: readonly string[]): PropertyBag {
  const result: PropertyBag = {};
  for (const key of propKeys) {
    const prop = properties[key] ?? {};
    const configDefKey = findConfigDefKey(prop, configKeys);
    result[key] = { ...prop, type: 'configuration', section: defs[configDefKey]?.metadata?.section ?? '' };
  }
  return result;
}

/** Categorises `properties` by synthetic reference kind, tags each with the shape `ToolBaseProperty.tsx` expects, and returns them pre-ordered (configuration -> model refs -> entity refs -> ordinary properties). */
function categorizeProperties(properties: Readonly<PropertyBag>, defs: DefsBag): PropertyBag {
  const { llmModelProps, embeddingModelProps, imageGenerationModelProps, toolkitProps, agentProps, pipelineProps, configProps, nonConfigProps } = selectPropertyKeys(properties, defs);

  return {
    ...buildConfigProperties(configProps, properties, defs, Object.keys(defs)),
    ...buildModelReferenceProperties(llmModelProps, properties, 'llm_model'),
    ...buildModelReferenceProperties(embeddingModelProps, properties, 'embedding_model'),
    ...buildModelReferenceProperties(imageGenerationModelProps, properties, 'image_generation_model'),
    ...buildToolkitReferenceProperties(toolkitProps, properties),
    ...buildAgentReferenceProperties(agentProps, properties),
    ...buildPipelineReferenceProperties(pipelineProps, properties),
    ...buildNormalProperties(nonConfigProps, properties),
  };
}

export interface RawToolkitTypeSchema {
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly $defs?: Readonly<Record<string, { readonly metadata?: { readonly section?: string } } | undefined>>;
  readonly [key: string]: unknown;
}

export function convertToolkitSchema(toolSchema: RawToolkitTypeSchema | undefined): ConvertedToolkitSchema {
  if (!toolSchema || Object.keys(toolSchema).length === 0) {
    return { properties: {} };
  }

  const { properties: rawProperties, required, $defs, ...rest } = toolSchema;
  const properties = flattenJsonSchemaExtra(rawProperties);

  return {
    ...rest,
    required,
    properties: categorizeProperties(properties, $defs ?? {}),
  };
}
