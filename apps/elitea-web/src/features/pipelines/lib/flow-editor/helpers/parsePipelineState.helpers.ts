/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * helpers/parsePipeline.helpers.js:18-61` (unit A2c) — the synthetic State
 * node builder and the orientation-aware node-position calculator, split out
 * (no baseline counterpart of its own) so `parsePipelineGraphPrimitives.
 * helpers.ts` can depend on `getNodePosition` without importing the much
 * larger `parsePipeline.helpers.ts` (which itself depends back on the
 * traversal/branch modules) — avoids a circular import between this unit's
 * files while keeping the baseline's single `parsePipeline.helpers` surface
 * (re-exported from `./parsePipeline.helpers.ts`).
 */
import {
  ORIENTATION,
  PIPELINE_STATE,
  STATE_INPUT,
  STATE_MESSAGES,
  type Orientation,
} from '../constants/flowEditor.constants';
import type { FlowGraphNode, YamlPipelineDocument } from './pipelineFlow.types';

interface StateNodeVariable {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly value?: unknown;
  readonly enabled?: boolean;
}

export const parseState = (yamlJson: YamlPipelineDocument | undefined): FlowGraphNode | null => {
  if (yamlJson?.state) {
    const firstTwoDefaultVariables: StateNodeVariable[] = Object.entries(yamlJson.state)
      .filter(([key]) => key.toLowerCase() === STATE_INPUT || key.toLowerCase() === STATE_MESSAGES)
      .map(([key, value]) => ({
        id: key,
        name: key,
        // for old state, the format is variable: type; for new state, the format is variable: { type: str, value: 'str value' }
        type: typeof value === 'string' ? value : (value?.type || 'str'),
        // `value?.value` — `typeof null === 'object'` in JS, so an explicit YAML `null` entry
        // (`state: { input: null }`) takes this branch with `value` itself `null`; `value.value`
        // would throw. Matches baseline `parsePipeline.helpers.js:25`'s `value?.value || ''`.
        value: typeof value === 'object' ? (value?.value ?? '') : undefined,
        enabled: true,
      }));
    const leftVariables: StateNodeVariable[] = Object.entries(yamlJson.state)
      .filter(([key]) => key.toLowerCase() !== STATE_INPUT && key.toLowerCase() !== STATE_MESSAGES)
      .map(([key, value]) => ({
        id: key,
        name: key,
        type: typeof value === 'string' ? value : (value?.type || 'str'),
        // `value?.value` — same explicit-YAML-`null` guard as the `firstTwoDefaultVariables`
        // map above.
        value: typeof value === 'object' ? (value?.value ?? '') : undefined,
      }));
    return {
      id: PIPELINE_STATE,
      data: {
        label: 'State',
        variables: [...firstTwoDefaultVariables, ...leftVariables],
      },
      position: { x: 20, y: 20 },
      type: PIPELINE_STATE,
      draggable: false, // make the node fixed
    };
  }
  return null;
};

export const getNodePosition = (
  nodes: readonly unknown[],
  orientation: Orientation = ORIENTATION.vertical,
): { x: number; y: number } =>
  orientation === ORIENTATION.horizontal
    ? { x: 60 + nodes.length * 670, y: 200 }
    : { x: 60, y: 200 + nodes.length * 670 };
