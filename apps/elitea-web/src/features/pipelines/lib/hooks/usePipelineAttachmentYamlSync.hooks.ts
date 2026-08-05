import { useEffect, useRef } from 'react';

import { dump } from 'js-yaml';

import { FlowEditorConstants } from '../flow-editor/constants';
import { usePipelineYamlStore } from '../../model/pipelineYamlStore';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/lib/hooks/
 * usePipelineAttachmentYamlSync.hooks.js`.
 *
 * Watches the pipeline's internal_tools list and keeps the `input_attachments`
 * YAML state variable in sync: adds it when attachments are enabled, removes
 * it when they are disabled.
 *
 * **Disclosed deviation:** the baseline reads `useFormikContext()` for
 * `values.version_details.meta.internal_tools` and dispatches to
 * `state.pipeline` via Redux. This app has no Formik (§2.3) and this
 * store's own `usePipelineYamlStore.ts` (this sub-unit's own file) replaces
 * the Redux slice — `hasAttachments` becomes an explicit boolean parameter
 * (the caller reads it from wherever its own live form state lives, matching
 * the "ambient Formik -> explicit prop" convention this codebase already
 * establishes elsewhere, e.g. `features/agents/lib/useAgentAttachments.ts`'s
 * own identical `internalTools` parameter for the SAME underlying baseline
 * field). `dispatch(pipelineActions.setYamlCode(...))`/
 * `setYamlJsonObject(...)` become direct `usePipelineYamlStore` setter calls.
 *
 * Must be called inside whatever owns the pipeline's live `internal_tools`
 * value on the pipeline configuration page (baseline: inside the Formik
 * context on `pages/Pipelines/Components/ConfigurationTab.jsx`).
 */
export function usePipelineAttachmentYamlSync(hasAttachments: boolean): void {
  const yamlCode = usePipelineYamlStore((state) => state.yamlCode);
  const yamlJsonObject = usePipelineYamlStore((state) => state.yamlJsonObject);
  const setYamlCode = usePipelineYamlStore((state) => state.setYamlCode);
  const setYamlJsonObject = usePipelineYamlStore((state) => state.setYamlJsonObject);

  // Keep a ref so the effect always reads the latest YAML object without
  // needing to re-run whenever any unrelated YAML change happens.
  const yamlJsonObjectRef = useRef(yamlJsonObject);
  yamlJsonObjectRef.current = yamlJsonObject;

  useEffect(() => {
    const currentYamlObj = yamlJsonObjectRef.current;
    const currentState = (currentYamlObj['state'] as Readonly<Record<string, unknown>> | undefined) ?? {
      ...FlowEditorConstants.DefaultState,
    };
    const alreadyHasKey = FlowEditorConstants.STATE_INPUT_ATTACHMENTS in currentState;

    if (hasAttachments && !alreadyHasKey) {
      const updated = {
        ...currentYamlObj,
        state: {
          ...currentState,
          [FlowEditorConstants.STATE_INPUT_ATTACHMENTS]: { type: FlowEditorConstants.StateVariableTypes.List, default: [] },
        },
      };
      setYamlCode(dump(updated));
      setYamlJsonObject(updated);
    } else if (!hasAttachments && alreadyHasKey) {
      const remainingState = Object.fromEntries(
        Object.entries(currentState).filter(([key]) => key !== FlowEditorConstants.STATE_INPUT_ATTACHMENTS),
      );
      const updated = { ...currentYamlObj, state: remainingState };
      setYamlCode(dump(updated));
      setYamlJsonObject(updated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAttachments, yamlCode, setYamlCode, setYamlJsonObject]);
}
