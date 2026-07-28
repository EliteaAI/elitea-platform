/**
 * `FlowEditorContext` / `NodeCardContext` -- the two React contexts the
 * flow-editor's node/canvas components thread editor-wide state through in
 * the baseline. NOT a 1:1 file port: the baseline defines both contexts
 * (createContext calls) together with their JSX `<Provider>` components in
 * `apps/elitea-ui/src/[fsd]/app/providers/{FlowEditorProvider,
 * NodeCardProvider}.jsx`. That location is illegal here -- `app/` sits
 * ABOVE `features/` in the layer model (spec section 3.2:
 * `app -> processes -> pages -> widgets -> features -> entities -> shared`),
 * so a `features/pipelines` file may never import from `src/app/` (R-L1).
 *
 * Disclosed split, not a reinterpretation: the *context objects*
 * (createContext, no JSX) are genuinely `lib` content this sub-unit (A2d)
 * needs to compile its owned hooks (`useNodeCardContext.ts`,
 * `useInputOptions.ts`, `useNodeOptions.ts`, `useFunctionInputMapping.ts`
 * all call `useContext(...)` on these) -- A2d is scoped "pure lib, no JSX",
 * so it stops here. The `<FlowEditorContext.Provider>` /
 * `<NodeCardContext.Provider>` JSX itself (baseline:
 * `FlowEditorProvider.jsx:8-45`, `ui/nodes/BaseNode/NodeCard.jsx:27`,
 * `ui/nodes/EndNode.jsx:17`) is canvas UI and belongs to whichever
 * pipelines sub-unit owns `features/pipelines/ui/**` -- not built here.
 *
 * Value shapes are transcribed verbatim from the baseline providers' own
 * `contextValue` / inline-object construction (not invented):
 * `FlowEditorProvider.jsx:10-44`, `NodeCard.jsx:27` / `EndNode.jsx:17`
 * (`{ isExpanded }`).
 */
import { createContext } from 'react';

import type { YamlPipelineDocument } from './helpers/pipelineFlow.types';
import type { SetFlowEdges, SetFlowNodes, SetYamlJsonObject } from './reactFlowTypes';

/** `FlowEditorProvider.jsx:10-22` -- every field the Provider passes down, none invented. */
export interface FlowEditorContextValue {
  readonly editorHeight?: number;
  readonly editorWidth?: number;
  readonly yamlJsonObject: YamlPipelineDocument;
  readonly setYamlJsonObject: SetYamlJsonObject;
  readonly deleteRunNode?: (id: string) => void;
  readonly isRunningPipeline?: boolean;
  readonly handleDeleteNode?: (id: string) => void;
  readonly expandAll?: boolean;
  readonly setFlowNodes: SetFlowNodes;
  readonly setFlowEdges: SetFlowEdges;
  readonly disabled?: boolean;
}

/**
 * `React.createContext()` in the baseline has no default value (`undefined`
 * outside a Provider) -- preserved here rather than inventing a fallback.
 */
export const FlowEditorContext = createContext<FlowEditorContextValue | undefined>(undefined);

/** `NodeCard.jsx:27` / `EndNode.jsx:17` -- the only shape ever passed to `NodeCardContext.Provider`. */
export interface NodeCardContextValue {
  readonly isExpanded: boolean;
}

export const NodeCardContext = createContext<NodeCardContextValue | undefined>(undefined);
