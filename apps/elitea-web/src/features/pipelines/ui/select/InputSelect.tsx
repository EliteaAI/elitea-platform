import type { ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';

import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import * as FlowEditorHelpers from '../../lib/flow-editor/helpers/flowEditor.helpers';
import { useInputOptions } from '../../lib/flow-editor/hooks/useInputOptions';
import { PipelineMultiSelect, type PipelineMultiSelectOption } from './PipelineMultiSelect';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * select/InputSelect.jsx` (unit A2h). Reads `FlowEditorContext` from
 * `../../lib/flow-editor/flowEditorContext.ts` instead of the baseline's
 * `app/providers` import (that file's own doc comment covers the R-L1
 * rationale, same as every A2 sub-unit's flow-editor hooks).
 *
 * `Select.SingleSelect` (`multiple`) -> `PipelineMultiSelect` (this
 * sub-unit's own local multi-value primitive) -- see that file's doc
 * comment for why `shared/ui/SingleSelect` cannot serve this baseline
 * component (single-value only).
 */
export interface InputSelectProps {
  readonly id: string;
  readonly label?: string;
  readonly inputFieldName?: string;
  readonly disabled?: boolean | undefined;
}

export function InputSelect(props: InputSelectProps): ReactNode {
  const { id, label = 'Input', inputFieldName = 'input', disabled = false } = props;

  const context = useContext(FlowEditorContext);
  const yamlJsonObject = context?.yamlJsonObject;
  const setYamlJsonObject = context?.setYamlJsonObject;

  const yamlNode = useMemo(
    () => yamlJsonObject?.nodes?.find(node => node.id === id),
    [id, yamlJsonObject?.nodes],
  );

  const inputOptions = useInputOptions();

  const inputFromNode = useMemo(() => {
    const raw = yamlNode ? yamlNode[inputFieldName] : undefined;
    return Array.isArray(raw) ? (raw as string[]) : [];
  }, [inputFieldName, yamlNode]);

  const onChangeInput = useCallback(
    (newValue: string[]) => {
      if (!setYamlJsonObject) return;
      FlowEditorHelpers.updateYamlNode(id, inputFieldName, newValue, yamlJsonObject, setYamlJsonObject);
    },
    [id, inputFieldName, setYamlJsonObject, yamlJsonObject],
  );

  const realInputOptions = useMemo<PipelineMultiSelectOption[]>(() => {
    const optionsNotInState: PipelineMultiSelectOption[] = inputFromNode
      .filter(item => !inputOptions.find(option => option.value === item))
      .map(item => ({ label: item, value: item, canDelete: true }));
    return [...optionsNotInState, ...inputOptions];
  }, [inputFromNode, inputOptions]);

  const onDeleteOption = useCallback(
    (value: string) => {
      if (!setYamlJsonObject) return;
      FlowEditorHelpers.updateYamlNode(
        id,
        inputFieldName,
        inputFromNode.filter(item => item !== value),
        yamlJsonObject,
        setYamlJsonObject,
      );
    },
    [id, inputFieldName, inputFromNode, setYamlJsonObject, yamlJsonObject],
  );

  return (
    <PipelineMultiSelect
      label={label}
      value={inputFromNode}
      onValueChange={onChangeInput}
      options={realInputOptions}
      disabled={disabled}
      className="nopan nodrag nowheel"
      onDeleteOption={onDeleteOption}
    />
  );
}
