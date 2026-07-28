/**
 * Local, full port of `apps/elitea-ui/src/common/toolkitSchemaUtils.js`'s
 * `convertToolkitSchema` — a pure, self-contained function (no imports of
 * its own) that categorizes a toolkit type's JSON-Schema properties
 * (config/llm-model/embedding-model/toolkit-ref/agent-ref/pipeline-ref/
 * plain) and flattens Pydantic v2's `json_schema_extra`. Split out of
 * `ui/IndexDetails/IndexActions.tsx` (unit A4a, this function's sole
 * consumer — `IndexActions` only reads ONE downstream fact from its output:
 * which property, if any, has `section === 'credentials'`, but that fact
 * depends on the `configProperties` branch's `section` assignment, so the
 * transform is ported in full rather than approximated) purely to keep that
 * file under the repo's 400-line budget (R-eslint(max-lines)) — no behavior
 * change, see `IndexActions.tsx`'s own doc comment for the "why a local
 * copy" rationale, which still applies unchanged from this new location.
 * Not indexes-specific (every toolkit-settings-driven form needs it) and
 * not part of this unit's owned files or A4b's named dependencies — same
 * "port it yourself, locally" treatment as `useSelectedProjectId.ts`.
 */

/** The JSON-Schema-like shape `convertToolkitSchema` operates on — matches `apps/elitea-ui/src/common/toolkitSchemaUtils.js`'s input contract. */
export interface ToolkitTypeSchema {
  readonly properties?: Record<string, ToolkitSchemaProperty>;
  readonly required?: readonly string[] | undefined;
  readonly $defs?: Record<string, { readonly metadata?: { readonly section?: string } }>;
  readonly [key: string]: unknown;
}

interface ToolkitSchemaProperty {
  readonly section?: string;
  readonly json_schema_extra?: Record<string, unknown>;
  readonly configuration_model?: string;
  readonly toolkit_types?: unknown;
  readonly agent_tags?: unknown;
  readonly pipeline_tags?: unknown;
  readonly $ref?: string;
  readonly anyOf?: unknown;
  readonly [key: string]: unknown;
}

/** One `anyOf[]` entry this file's `$ref` resolution reads. */
interface AnyOfRefEntry {
  readonly $ref?: string;
}

/** Runtime narrowing for `ToolkitSchemaProperty.anyOf` (typed `unknown` — a backend-shaped JSON-Schema union whose element shape is asserted here, not assumed via a declared array type, since that combined with this interface's open index signature otherwise resolves as `any` at every access site). */
function isAnyOfRefArray(value: unknown): value is readonly AnyOfRefEntry[] {
  return Array.isArray(value);
}

function flattenJsonSchemaExtra(properties: Record<string, ToolkitSchemaProperty> | undefined): Record<string, ToolkitSchemaProperty> {
  if (!properties) return {};
  const result: Record<string, ToolkitSchemaProperty> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value && typeof value === 'object') {
      const { json_schema_extra, ...rest } = value;
      result[key] = { ...rest, ...json_schema_extra };
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function convertToolkitSchema(toolSchema: ToolkitTypeSchema | undefined): ToolkitTypeSchema {
  if (!toolSchema || Object.keys(toolSchema).length === 0) return {};

  const { properties: rawProperties, required, $defs, ...rest } = toolSchema;
  const properties = flattenJsonSchemaExtra(rawProperties);
  const configKeys = Object.keys($defs ?? {});

  const stripDefsPrefix = (ref: string): string => ref.replace('#/$defs/', '');

  const findConfigRef = (anyOf: readonly AnyOfRefEntry[]): string | undefined => {
    for (const item of anyOf) {
      if (item.$ref !== undefined && configKeys.includes(stripDefsPrefix(item.$ref))) return item.$ref;
    }
    return undefined;
  };

  const refDefKey = (property: ToolkitSchemaProperty): string => {
    if (isAnyOfRefArray(property.anyOf)) {
      const matchRef = findConfigRef(property.anyOf);
      return matchRef !== undefined ? stripDefsPrefix(matchRef) : '';
    }
    return property.$ref !== undefined ? stripDefsPrefix(property.$ref) : '';
  };

  const keys = Object.keys(properties);
  const llmModelProps = keys.filter((key) => properties[key]?.configuration_model === 'llm' || key === 'llm_model');
  const embeddingModelProps = keys.filter((key) => properties[key]?.configuration_model === 'embedding' || key === 'embedding_model');
  const imageGenerationModelProps = keys.filter((key) => properties[key]?.configuration_model === 'image_generation' || key === 'image_generation_model');
  const toolkitProps = keys.filter((key) => properties[key]?.toolkit_types);
  const agentProps = keys.filter((key) => properties[key]?.agent_tags);
  const pipelineProps = keys.filter((key) => properties[key]?.pipeline_tags);
  const configProps = keys.filter((key) => configKeys.includes(refDefKey(properties[key]!)));
  const nonConfigProps = keys.filter(
    (key) =>
      !configProps.includes(key) &&
      !embeddingModelProps.includes(key) &&
      !imageGenerationModelProps.includes(key) &&
      !llmModelProps.includes(key) &&
      !toolkitProps.includes(key) &&
      !agentProps.includes(key) &&
      !pipelineProps.includes(key),
  );

  const byKeys = (list: readonly string[], build: (key: string) => ToolkitSchemaProperty): Record<string, ToolkitSchemaProperty> =>
    Object.fromEntries(list.map((key) => [key, build(key)]));

  return {
    ...rest,
    required,
    properties: {
      ...byKeys(configProps, (key) => ({ ...properties[key], type: 'configuration', section: $defs?.[refDefKey(properties[key]!)]?.metadata?.section ?? '' })),
      ...byKeys(llmModelProps, (key) => ({ ...properties[key], type: 'llm_model' })),
      ...byKeys(embeddingModelProps, (key) => ({ ...properties[key], type: 'embedding_model' })),
      ...byKeys(imageGenerationModelProps, (key) => ({ ...properties[key], type: 'image_generation_model' })),
      ...byKeys(toolkitProps, (key) => ({ ...properties[key], type: 'toolkit_reference' })),
      ...byKeys(agentProps, (key) => ({ ...properties[key], type: 'agent_reference' })),
      ...byKeys(pipelineProps, (key) => ({ ...properties[key], type: 'pipeline_reference' })),
      ...byKeys(nonConfigProps, (key) => ({ ...properties[key] })),
    },
  };
}
