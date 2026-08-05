/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * hooks/useNodeOptions.hooks.js` (23 lines, unit A2d). Reads
 * `../flowEditorContext.ts`'s `FlowEditorContext` instead of the baseline's
 * `app/providers` import -- see that file's header for the R-L1 rationale.
 */
import { useContext, useMemo } from 'react';

import type { YamlPipelineNode } from '../helpers/pipelineFlow.types';
import { FlowEditorContext } from '../flowEditorContext';

export interface NodeOption {
  readonly label: string;
  readonly value: string;
}

export function useNodeOptions(
  nodeFilter: (node: YamlPipelineNode) => boolean = () => true,
  addEndNode?: boolean,
): NodeOption[] {
  const context = useContext(FlowEditorContext);
  const yamlJsonObject = context?.yamlJsonObject;

  return useMemo(() => {
    const options = (yamlJsonObject?.nodes ?? [])
      .filter(nodeFilter)
      .map(node => ({ label: node.id, value: node.id }));

    if (addEndNode) {
      options.push({ label: 'END', value: 'END' });
    }

    return options;
    // baseline's own deps array (useNodeOptions.hooks.js:9-16): `[nodeFilter, addEndNode, yamlJsonObject.nodes]`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeFilter, addEndNode, yamlJsonObject?.nodes]);
}
