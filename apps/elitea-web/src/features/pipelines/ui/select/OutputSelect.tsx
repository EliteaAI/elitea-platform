import type { ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';

import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import * as FlowEditorHelpers from '../../lib/flow-editor/helpers/flowEditor.helpers';
import { useInputOptions } from '../../lib/flow-editor/hooks/useInputOptions';
import { PipelineMultiSelect, type PipelineMultiSelectOption } from './PipelineMultiSelect';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * select/OutputSelect.jsx` (unit A2h). See `InputSelect.tsx`'s doc comment
 * for the `FlowEditorContext`-source and `PipelineMultiSelect` deviations
 * (identical rationale, not repeated here).
 */
export interface OutputSelectProps {
  readonly id: string;
  readonly label?: string;
  readonly outputFieldName?: string;
  readonly disabled?: boolean | undefined;
}

export function OutputSelect(props: OutputSelectProps): ReactNode {
  const { id, label = 'Output', outputFieldName = 'output', disabled = false } = props;

  const context = useContext(FlowEditorContext);
  const yamlJsonObject = context?.yamlJsonObject;
  const setYamlJsonObject = context?.setYamlJsonObject;
  const isRunningPipeline = context?.isRunningPipeline;

  const yamlNode = useMemo(
    () => yamlJsonObject?.nodes?.find(node => node.id === id),
    [id, yamlJsonObject?.nodes],
  );

  const outputFromNode = useMemo(() => {
    const raw = yamlNode ? yamlNode[outputFieldName] : undefined;
    return Array.isArray(raw) ? (raw as string[]) : [];
  }, [outputFieldName, yamlNode]);

  const outputOptions = useInputOptions();

  const onChangeInput = useCallback(
    (newValue: string[]) => {
      if (!setYamlJsonObject) return;
      FlowEditorHelpers.updateYamlNode(id, outputFieldName, newValue, yamlJsonObject, setYamlJsonObject);
    },
    [id, outputFieldName, setYamlJsonObject, yamlJsonObject],
  );

  const realInputOptions = useMemo<PipelineMultiSelectOption[]>(() => {
    const optionsNotInState: PipelineMultiSelectOption[] = outputFromNode
      .filter(item => !outputOptions.find(option => option.value === item))
      .map(item => ({ label: item, value: item, canDelete: true, tooltip: 'Not in state' }));
    return [...optionsNotInState, ...outputOptions];
  }, [outputFromNode, outputOptions]);

  const onDeleteOption = useCallback(
    (value: string) => {
      if (!setYamlJsonObject) return;
      FlowEditorHelpers.updateYamlNode(
        id,
        outputFieldName,
        outputFromNode.filter(item => item !== value),
        yamlJsonObject,
        setYamlJsonObject,
      );
    },
    [id, outputFieldName, outputFromNode, setYamlJsonObject, yamlJsonObject],
  );

  return (
    <PipelineMultiSelect
      label={label}
      value={outputFromNode}
      onValueChange={onChangeInput}
      options={realInputOptions}
      disabled={disabled || Boolean(isRunningPipeline)}
      className="nopan nodrag nowheel"
      onDeleteOption={onDeleteOption}
    />
  );
}
