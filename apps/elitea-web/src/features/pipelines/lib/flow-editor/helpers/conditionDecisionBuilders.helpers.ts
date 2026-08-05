/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/pipelines/
 * flow-editor/lib/helpers/conditionDecisionBuilders.helpers.js` (unit A2c).
 *
 * `yamlNode` is typed `unknown`, matching the baseline (plain JS, no type at
 * all) and the observed real call site in a sibling flow-editor sub-unit's
 * `connectionOperations.helpers.ts` (`updateConditionNodeData`/
 * `updateLegacyDecisionNodeData`, both typed `yamlNode: unknown` — see
 * `./pipelineFlow.types.ts`'s doc comment for why this unit doesn't hard-
 * import that sibling's types). A narrower object type here would reject a
 * real, legitimate caller passing `unknown`.
 */
import { addTargetToArray } from './nodeOperations.helpers';
import type { FlowGraphConnection, YamlConditionSpec, YamlDecisionSpec } from './pipelineFlow.types';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Generic builder for condition/decision structures.
 * @param yamlNode - The YAML node
 * @param connection - The connection object
 * @param propertyName - The property name ('condition' or 'decision')
 * @param arrayHandle - The handle name for array updates ('conditional_outputs' or 'nodes')
 * @param arrayKey - The key for array updates ('conditional_outputs' or 'nodes')
 */
function buildNewStructure<TSpec extends { readonly default_output?: string }>(
  yamlNode: unknown,
  connection: FlowGraphConnection,
  propertyName: string,
  arrayHandle: string,
  arrayKey: string,
): TSpec {
  const isArrayHandle = connection.sourceHandle === arrayHandle;
  const yamlRecord = isPlainRecord(yamlNode) ? yamlNode : {};
  const baseStructure = (yamlRecord[propertyName] as Record<string, unknown> | undefined) ?? {};

  if (isArrayHandle) {
    return {
      ...baseStructure,
      [arrayKey]: addTargetToArray(baseStructure[arrayKey] as readonly string[] | undefined, connection.target),
    } as TSpec;
  }

  return {
    ...baseStructure,
    default_output: connection.target,
  } as TSpec;
}

export const buildNewCondition = (yamlNode: unknown, connection: FlowGraphConnection): YamlConditionSpec =>
  buildNewStructure<YamlConditionSpec>(
    yamlNode,
    connection,
    'condition',
    'conditional_outputs',
    'conditional_outputs',
  );

export const buildNewDecision = (yamlNode: unknown, connection: FlowGraphConnection): YamlDecisionSpec =>
  buildNewStructure<YamlDecisionSpec>(yamlNode, connection, 'decision', 'nodes', 'nodes');
