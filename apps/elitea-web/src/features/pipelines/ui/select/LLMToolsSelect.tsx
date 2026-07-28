import type { ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';

import type { Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { BasicAccordion, type AccordionItem, type BasicAccordionSlotSx } from '@/shared/ui/BasicAccordion';

import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import * as FlowEditorHelpers from '../../lib/flow-editor/helpers/flowEditor.helpers';
import { PipelineMultiSelect, type PipelineMultiSelectOption } from './PipelineMultiSelect';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * select/LLMToolsSelect.jsx` (unit A2h). `BasicAccordion` (`shared/ui`,
 * unit S1-B) replaces the baseline's `BasicAccordion` +
 * `AccordionConstants.AccordionShowMode.LeftMode` -- this port's
 * `showMode="left"` string literal (`shared/ui/StyledAccordionSummary`'s
 * own `AccordionShowMode = 'left' | 'right'`) is the same value, no
 * `AccordionConstants` namespace exists in this app (grepped: absent from
 * `shared/lib/**`). `Select.SingleSelect` (`multiple`) ->
 * `PipelineMultiSelect`, see `InputSelect.tsx`'s doc comment.
 */
export interface LLMToolsSelectProps {
  readonly toolkitName: string;
  readonly id: string;
  readonly tools?: readonly string[];
  readonly disabled?: boolean | undefined;
}

// baseline `!important`s (`palette.background.tabPanel !important`, `minHeight: '2rem !important'`)
// dropped -- R-T5 bans `!important` in `sx`; `BasicAccordion`'s own `slotSx`
// mechanism is the specificity-safe override channel it was built for, so
// no specificity fight exists here to escape.
const slotSx: BasicAccordionSlotSx = {
  accordion: (theme: Theme) => ({ background: theme.vars.palette.background.tabPanel }),
  summary: (theme: Theme) => ({
    background: theme.vars.palette.background.userInputBackground,
    borderRadius: theme.vars.shape.radiusMd,
    minHeight: '2rem',
  }),
  title: { color: 'text.secondary' },
  details: { marginTop: '0.5rem', paddingLeft: '0rem', gap: '0.5rem' },
};

export function LLMToolsSelect(props: LLMToolsSelectProps): ReactNode {
  const { toolkitName, id, tools = [], disabled = false } = props;

  const context = useContext(FlowEditorContext);
  const setYamlJsonObject = context?.setYamlJsonObject;
  const yamlJsonObject = context?.yamlJsonObject;

  const yamlNode = useMemo(
    () => yamlJsonObject?.nodes?.find(node => node.id === id),
    [id, yamlJsonObject?.nodes],
  );

  const selectedTools = useMemo(() => {
    const toolNames = (yamlNode?.['tool_names'] as Record<string, readonly string[]> | undefined) ?? {};
    const currentSelection = toolNames[toolkitName] ?? [];
    return currentSelection.filter(tool => tools.includes(tool)).sort((a, b) => a.localeCompare(b));
  }, [yamlNode, toolkitName, tools]);

  const toolOptions = useMemo<PipelineMultiSelectOption[]>(
    () => tools.map(tool => ({ label: tool, value: tool })).sort((a, b) => a.label.localeCompare(b.label)),
    [tools],
  );

  const handleToolsChange = useCallback(
    (newSelectedTools: string[]) => {
      if (!setYamlJsonObject) return;
      const currentToolNames = (yamlNode?.['tool_names'] as Record<string, readonly string[]> | undefined) ?? {};
      const updatedToolNames = { ...currentToolNames, [toolkitName]: newSelectedTools };
      FlowEditorHelpers.updateYamlNode(id, 'tool_names', updatedToolNames, yamlJsonObject, setYamlJsonObject);
    },
    [id, toolkitName, yamlNode, yamlJsonObject, setYamlJsonObject],
  );

  const accordionItems = useMemo<AccordionItem[]>(
    () => [
      {
        title: `${toolkitName} (${selectedTools.length}/${tools.length})`,
        content: (
          <PipelineMultiSelect
            options={toolOptions}
            value={selectedTools}
            onValueChange={handleToolsChange}
            label={t('pipelines.llmToolsSelect.toolsLabel', 'Tools')}
            className="nopan nodrag nowheel"
            disabled={disabled}
          />
        ),
      },
    ],
    [toolkitName, selectedTools, tools.length, toolOptions, handleToolsChange, disabled],
  );

  return (
    <BasicAccordion
      showMode="left"
      slotSx={slotSx}
      items={accordionItems}
      defaultExpanded
    />
  );
}
