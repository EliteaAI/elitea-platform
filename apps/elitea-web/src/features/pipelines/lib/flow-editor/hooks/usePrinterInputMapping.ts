/**
 * Ported from `apps/elitea-ui/src/hooks/pipeline/usePrinterInputMapping.js`
 * (78 lines, unit A2e). Gap-fill: this file was found needed by
 * `ui/nodes/PrinterNode.jsx` but missing from every sub-unit's original
 * owned-file list (a real F5 partition gap, not a boundary dispute) --
 * ported here since it co-locates with its consumer,
 * `../../ui/nodes/PrinterNode.tsx` (also owned by this sub-unit).
 *
 * Reads `../flowEditorContext.ts`'s `FlowEditorContext` instead of the
 * baseline's `app/providers` import -- see that file's header for the R-L1
 * rationale (same convention already established by A2d's
 * `useInputOptions.ts`/`useNodeOptions.ts`). Lives in `lib/flow-editor/
 * hooks/`, matching where those sibling hooks landed.
 */
import { useCallback, useContext, useEffect, useMemo } from 'react';

import { batchUpdateYamlNode } from '../helpers/flowEditor.helpers';
import { FlowEditorContext } from '../flowEditorContext';

import type { YamlInputMappingEntry } from '../helpers/pipelineFlow.types';

/** `usePrinterInputMapping.js:6-8` verbatim. */
export function getDefaultPrinterInputMapping(): Readonly<Record<'printer', YamlInputMappingEntry>> {
  return {
    printer: { type: 'fixed', value: '' },
  };
}

export interface UsePrinterInputMappingParams {
  readonly id: string;
}

export interface UsePrinterInputMappingResult {
  readonly inputMappings: Readonly<Record<string, YamlInputMappingEntry>>;
  readonly onChangeMapping: (key: string, value: YamlInputMappingEntry) => void;
  readonly defaultValues: Readonly<Record<'printer', unknown>>;
}

export function usePrinterInputMapping({ id }: UsePrinterInputMappingParams): UsePrinterInputMappingResult {
  const context = useContext(FlowEditorContext);
  const yamlJsonObject = context?.yamlJsonObject;
  const setYamlJsonObject = context?.setYamlJsonObject;

  const yamlNode = useMemo(
    () => yamlJsonObject?.nodes?.find(node => node.id === id),
    [id, yamlJsonObject?.nodes],
  );

  const inputMappings = useMemo(() => {
    const defaultMapping = getDefaultPrinterInputMapping();
    const existingInputMapping = yamlNode?.input_mapping ?? {};

    // Merge with defaults, ensuring each property has both type and value (`usePrinterInputMapping.js:22-32`).
    const merged: Record<string, YamlInputMappingEntry> = {};
    for (const key of Object.keys(defaultMapping)) {
      merged[key] = existingInputMapping[key] ?? defaultMapping[key as 'printer'];
    }

    return merged;
  }, [yamlNode?.input_mapping]);

  // Initialize YAML input_mapping if it doesn't exist (`usePrinterInputMapping.js:36-50`).
  useEffect(() => {
    const defaultMapping = getDefaultPrinterInputMapping();
    const existingKeys = Object.keys(yamlNode?.input_mapping ?? {});
    const requiredInputs = ['printer'];

    if (
      (!existingKeys.length || requiredInputs.some(input => !existingKeys.includes(input))) &&
      setYamlJsonObject
    ) {
      batchUpdateYamlNode(id, { input_mapping: defaultMapping }, yamlJsonObject, setYamlJsonObject);
    }
  }, [id, yamlNode?.input_mapping, yamlJsonObject, setYamlJsonObject]);

  const onChangeMapping = useCallback(
    (key: string, value: YamlInputMappingEntry) => {
      const updatedMapping = { ...inputMappings, [key]: value };
      if (setYamlJsonObject) {
        batchUpdateYamlNode(id, { input_mapping: updatedMapping }, yamlJsonObject, setYamlJsonObject);
      }
    },
    [id, inputMappings, yamlJsonObject, setYamlJsonObject],
  );

  const defaultValues = useMemo(() => ({ printer: getDefaultPrinterInputMapping().printer.value }), []);

  return {
    inputMappings,
    onChangeMapping,
    defaultValues,
  };
}
