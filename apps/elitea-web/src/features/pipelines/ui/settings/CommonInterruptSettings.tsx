import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseSwitch } from '@/shared/ui/BaseSwitch';

import { FlowEditorConstants } from '../../lib/flow-editor/constants';
import { FlowEditorContext, type FlowEditorContextValue } from '../../lib/flow-editor/flowEditorContext';
import * as FlowEditorHelpers from '../../lib/flow-editor/helpers/flowEditor.helpers';
import type { YamlPipelineDocument, YamlPipelineNode } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import type { FlowEdge } from '../../lib/flow-editor/reactFlowTypes';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * settings/CommonInterruptSettings.jsx` (unit A2h). Reads `FlowEditorContext`
 * from `../../lib/flow-editor/flowEditorContext.ts` (see `InputSelect.tsx`'s
 * doc comment for the R-L1 rationale) and `PipelineNodeTypes` via the
 * already-landed `FlowEditorConstants` namespace instead of a direct
 * `constants/flowEditor.constants` import, matching every other A2h/A2d
 * consumer of that module.
 *
 * `styled(FormControlLabel)` (baseline: `@emotion/styled`) -> a plain
 * `sx` object -- this app's `shared/ui` components consistently use MUI's
 * `sx` prop rather than `@emotion/styled` wrappers for one-off styling
 * (no `@emotion/styled` import appears anywhere else in this sub-unit's
 * sibling files), so the same convention is used here rather than
 * introducing a second styling mechanism for one component.
 *
 * Split into `useInterruptSettingsContext` (every `FlowEditorContext` read
 * and derived flag), `useInterruptToggleHandler` (the near-identical
 * before/after callback bodies), and a local `InterruptSwitchRow` --
 * purely to keep this function's own cyclomatic complexity under the
 * §3.5 budget (12), which oxlint's `complexity` rule counts against every
 * optional-chain/`??`/`&&`/`||`/default-param, not just `if`/ternary; no
 * behaviour change.
 */
export interface CommonInterruptSettingsProps {
  readonly id: string;
  readonly showStructuredOutput?: boolean;
  readonly type?: string;
  readonly disabled?: boolean | undefined;
}

const rowSx: SxProps<Theme> = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', width: '100%', flexDirection: 'row' };

function switchLabelSx(theme: Theme) {
  return {
    width: '13.375rem',
    height: '2rem',
    borderRadius: theme.vars.shape.radiusMd,
    marginLeft: '0rem',
    marginRight: '0rem',
    padding: '0.25rem 0.5rem',
    justifyContent: 'flex-start',
    gap: '0.5rem',
    background: theme.vars.palette.background.userInputBackground,
  };
}

interface InterruptSwitchRowProps {
  readonly disabled: boolean;
  readonly checked: boolean;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly label: ReactNode;
  readonly emphasized: boolean;
}

function InterruptSwitchRow({ disabled, checked, onChange, label, emphasized }: InterruptSwitchRowProps): ReactNode {
  return (
    <FormControlLabel
      sx={switchLabelSx}
      control={
        <BaseSwitch
          disabled={disabled}
          checked={checked}
          onChange={onChange}
        />
      }
      label={
        <Typography
          variant="labelSmall"
          color={emphasized ? 'text.primary' : 'text.secondary'}
        >
          {label}
        </Typography>
      }
      labelPlacement="end"
    />
  );
}

interface UseInterruptToggleHandlerArgs {
  readonly id: string;
  readonly field: 'interrupt_before' | 'interrupt_after';
  readonly edgeSide: 'target' | 'source';
  readonly current: readonly string[];
  readonly yamlJsonObject: YamlPipelineDocument | undefined;
  readonly setYamlJsonObject: ((next: YamlPipelineDocument) => void) | undefined;
  readonly setFlowEdges: ((updater: (prev: FlowEdge[]) => FlowEdge[]) => void) | undefined;
}

/** Shared body of `onChangeInterruptBefore`/`onChangeInterruptAfter` -- see this file's own doc comment. */
function useInterruptToggleHandler(args: UseInterruptToggleHandlerArgs): (event: ChangeEvent<HTMLInputElement>) => void {
  const { id, field, edgeSide, current, yamlJsonObject, setYamlJsonObject, setFlowEdges } = args;
  return useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!setYamlJsonObject) return;
      const nextList = event.target.checked ? [...current, id] : current.filter(item => item !== id);
      setYamlJsonObject({ ...yamlJsonObject, [field]: nextList });
      setFlowEdges?.(prevEdges =>
        prevEdges.map(edge => (edge[edgeSide] === id ? { ...edge, data: event.target.checked ? { label: 'interrupt' } : {} } : edge)),
      );
    },
    [id, field, edgeSide, current, yamlJsonObject, setYamlJsonObject, setFlowEdges],
  );
}

interface InterruptSettingsContext {
  readonly yamlJsonObject: YamlPipelineDocument | undefined;
  readonly setYamlJsonObject: FlowEditorContextValue['setYamlJsonObject'] | undefined;
  readonly setFlowEdges: FlowEditorContextValue['setFlowEdges'] | undefined;
  readonly yamlNode: YamlPipelineNode | undefined;
  readonly isEntryPoint: boolean;
  readonly isEndTransition: boolean;
  readonly realInterruptBefore: readonly string[];
  readonly realInterruptAfter: readonly string[];
}

/** Every `FlowEditorContext` read plus derived entry-point/end-transition flags for this node -- see this file's own doc comment. */
function useInterruptSettingsContext(id: string, type: string | undefined): InterruptSettingsContext {
  const context = useContext(FlowEditorContext);
  const yamlJsonObject = context?.yamlJsonObject;

  const yamlNode = useMemo(() => yamlJsonObject?.nodes?.find(node => matchesNode(node, id, type)), [id, type, yamlJsonObject]);

  return {
    yamlJsonObject,
    setYamlJsonObject: context?.setYamlJsonObject,
    setFlowEdges: context?.setFlowEdges,
    yamlNode,
    isEntryPoint: yamlJsonObject?.entry_point === id,
    isEndTransition: yamlNode?.transition === FlowEditorConstants.PipelineNodeTypes.End,
    realInterruptBefore: yamlJsonObject?.interrupt_before ?? [],
    realInterruptAfter: yamlJsonObject?.interrupt_after ?? [],
  };
}

function matchesNode(node: YamlPipelineNode, id: string, type: string | undefined): boolean {
  return node.id === id && node.type === type;
}

export function CommonInterruptSettings(props: CommonInterruptSettingsProps): ReactNode {
  const { id, showStructuredOutput = true, type, disabled = false } = props;

  const { yamlJsonObject, setYamlJsonObject, setFlowEdges, yamlNode, isEntryPoint, isEndTransition, realInterruptBefore, realInterruptAfter } =
    useInterruptSettingsContext(id, type);

  const onChangeStructuredOutput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!setYamlJsonObject) return;
      FlowEditorHelpers.updateYamlNode(id, 'structured_output', event.target.checked, yamlJsonObject, setYamlJsonObject);
    },
    [yamlJsonObject, setYamlJsonObject, id],
  );

  const onChangeInterruptBefore = useInterruptToggleHandler({
    id,
    field: 'interrupt_before',
    edgeSide: 'target',
    current: realInterruptBefore,
    yamlJsonObject,
    setYamlJsonObject,
    setFlowEdges,
  });

  const onChangeInterruptAfter = useInterruptToggleHandler({
    id,
    field: 'interrupt_after',
    edgeSide: 'source',
    current: realInterruptAfter,
    yamlJsonObject,
    setYamlJsonObject,
    setFlowEdges,
  });

  return (
    <Box sx={rowSx}>
      <InterruptSwitchRow
        disabled={isEntryPoint || disabled}
        checked={!isEntryPoint && realInterruptBefore.includes(id)}
        onChange={onChangeInterruptBefore}
        label={t('pipelines.commonInterruptSettings.interruptBefore', 'Interrupt before')}
        emphasized={isEntryPoint}
      />
      <InterruptSwitchRow
        disabled={isEndTransition || disabled}
        checked={!isEndTransition && realInterruptAfter.includes(id)}
        onChange={onChangeInterruptAfter}
        label={t('pipelines.commonInterruptSettings.interruptAfter', 'Interrupt after')}
        emphasized={isEndTransition}
      />
      {showStructuredOutput && (
        <InterruptSwitchRow
          disabled={disabled}
          checked={Boolean(yamlNode?.structured_output)}
          onChange={onChangeStructuredOutput}
          label={t('pipelines.commonInterruptSettings.structuredOutput', 'Structured output')}
          emphasized={false}
        />
      )}
    </Box>
  );
}
