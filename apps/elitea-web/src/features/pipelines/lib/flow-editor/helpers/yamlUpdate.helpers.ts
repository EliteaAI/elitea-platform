/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/pipelines/
 * flow-editor/lib/helpers/yamlUpdate.helpers.js` (unit A2c).
 */
import { removeNodeIdFromArray } from './nodeOperations.helpers';
import type { YamlPipelineDocument } from './pipelineFlow.types';

/**
 * Updates or clears a property on a YAML node.
 *
 * **Narrower than the baseline's fully-generic, untyped version** (which
 * also handled `updates` being an array, replacing an array-valued
 * `existing` property wholesale): every one of this module's 4 exported
 * wrappers (the function's only real callers, in this same file) passes
 * either an object patch or `null`/`undefined` — never an array — so that
 * branch was baseline-dead-code for this module's actual call surface.
 * Typing `updates` as object-or-nullish (not `| readonly unknown[]`) is
 * therefore a faithful port of what this module is actually used for, and
 * sidesteps a `readonly T[]`/`Array.isArray` narrowing gap in this app's
 * lint/type tooling that a broader union would hit for no behavioural gain.
 * @param yamlNode - The YAML node to update
 * @param propertyName - The name of the property to update/clear
 * @param updates - Updates to merge, or null/undefined to clear
 * @returns Updated YAML node with the property modified
 */
function updateYamlNodeProperty<TNode extends Record<string, unknown>>(
  yamlNode: TNode,
  propertyName: string,
  updates: Record<string, unknown> | null | undefined,
): TNode {
  // Clear property if updates is null or undefined
  if (updates === null || updates === undefined) {
    return { ...yamlNode, [propertyName]: undefined };
  }

  const existing = yamlNode[propertyName];

  // If property exists and is an object (but not an array), merge updates.
  // Otherwise (property doesn't exist, or is an array), replace it with updates.
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return { ...yamlNode, [propertyName]: { ...(existing as Record<string, unknown>), ...updates } };
  }
  return { ...yamlNode, [propertyName]: updates };
}

export const updateYamlNodeCondition = <TNode extends Record<string, unknown>>(
  yamlNode: TNode,
  updates: Record<string, unknown> | null | undefined,
): TNode => updateYamlNodeProperty(yamlNode, 'condition', updates);

export const updateYamlNodeDecision = <TNode extends Record<string, unknown>>(
  yamlNode: TNode,
  updates: Record<string, unknown> | null | undefined,
): TNode => {
  if (!yamlNode['decision']) {
    return yamlNode;
  }
  return updateYamlNodeProperty(yamlNode, 'decision', updates);
};

export const clearYamlNodeCondition = <TNode extends Record<string, unknown>>(yamlNode: TNode): TNode =>
  updateYamlNodeProperty(yamlNode, 'condition', null);

export const clearYamlNodeDecision = <TNode extends Record<string, unknown>>(yamlNode: TNode): TNode =>
  updateYamlNodeProperty(yamlNode, 'decision', null);

export const updateYamlNodeTransition = <TNode extends Record<string, unknown>>(
  yamlNode: TNode,
  transition: string,
): TNode => ({
  ...yamlNode,
  transition,
});

export const removeInterruptReferences = (
  yamlJsonObject: YamlPipelineDocument,
  nodeId: string,
): YamlPipelineDocument => {
  let result: YamlPipelineDocument = { ...yamlJsonObject };
  if (result.interrupt_after) {
    result = { ...result, interrupt_after: removeNodeIdFromArray(result.interrupt_after, nodeId) };
  }
  if (result.interrupt_before) {
    result = { ...result, interrupt_before: removeNodeIdFromArray(result.interrupt_before, nodeId) };
  }
  return result;
};
