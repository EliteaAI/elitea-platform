/**
 * Pure helpers + presentational sub-components for `./HITLNode.tsx`, split
 * out purely to satisfy the §3.5 400-line file budget and cyclomatic
 * complexity budget (12) once `HITLNode.tsx` itself grew past both while
 * porting the baseline's `HITLNode.jsx` (333 lines) faithfully — same
 * technique `ui/nodes/BaseNode/NodeCardHeader.tsx` (A2e) already uses for
 * its own `.rename.ts`/`.styles.ts` split.
 */
import type { ReactNode } from 'react';
import { useCallback, useContext, useMemo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { HeadingChip } from '@/shared/ui/HeadingChip';
import { SingleSelect } from '@/shared/ui/SingleSelect';
import { t } from '@/shared/i18n';

import { useEdges } from '@xyflow/react';

import { FlowEditorConstants } from '../../lib/flow-editor/constants';
import { batchUpdateYamlNode, updateYamlNode } from '../../lib/flow-editor/helpers/flowEditor.helpers';
import { FlowEditorContext, type FlowEditorContextValue } from '../../lib/flow-editor/flowEditorContext';
import { useInputOptions } from '../../lib/flow-editor/hooks/useInputOptions';
import { useNodeAiAssistantConfig } from '../../lib/flow-editor/hooks/useNodeAiAssistantConfig';
import { useNodeOptions } from '../../lib/flow-editor/hooks/useNodeOptions';
import type { NodeOption } from '../../lib/flow-editor/hooks/useNodeOptions';
import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import type { AiAssistantLlmSettings } from '../../api/aiAssistantPredict';
import type { FlowEdge } from '../../lib/flow-editor/reactFlowTypes';
import { CustomHandle } from './CustomHandle';

export interface HitlAction {
  readonly label: string;
  readonly chipLabel: string;
  readonly value: 'approve' | 'edit' | 'reject';
}

export const HITL_ACTIONS: readonly HitlAction[] = [
  { label: 'Approve', chipLabel: 'APPROVE', value: 'approve' },
  { label: 'Edit', chipLabel: 'EDIT', value: 'edit' },
  { label: 'Reject', chipLabel: 'REJECT', value: 'reject' },
];

/** Pure extraction of the baseline's "is the Edit route selectable" ternary. */
export function computeRouteSelectDisabled(
  action: HitlAction['value'],
  isRunningPipeline: boolean,
  disabled: boolean,
  canEditRoute: boolean,
): boolean {
  if (isRunningPipeline || disabled) return true;
  return action === 'edit' && !canEditRoute;
}

/** Pure extraction of `handleRouteChange`'s edge-list rebuild. */
function buildRouteEdges(
  prevEdges: readonly FlowEdge[],
  id: string,
  action: HitlAction['value'],
  value: string,
  yamlJsonObject: YamlPipelineDocument,
): FlowEdge[] {
  const filteredEdges = prevEdges.filter(edge => edge.source !== id || edge.sourceHandle !== `hitlNode_${action}`);
  if (!value) return filteredEdges;
  const isEndTarget = value === FlowEditorConstants.PipelineNodeTypes.End;
  const isInterrupt =
    !isEndTarget && (Boolean(yamlJsonObject.interrupt_before?.includes(value)) || Boolean(yamlJsonObject.interrupt_after?.includes(id)));
  return [
    ...filteredEdges,
    {
      id: `xy-edge__${id}${action}---${value}`,
      source: id,
      sourceHandle: `hitlNode_${action}`,
      target: value,
      type: 'custom',
      // `exactOptionalPropertyTypes` forbids `{ label: undefined }` against `FlowEdgeData`'s `label?: string` — the key is omitted entirely instead.
      data: isInterrupt ? { label: 'interrupt' } : {},
    },
  ];
}

/** Pure extraction of the baseline's "not in state" synthetic option ternary. */
function computeEditStateKeyOptions(inputOptions: readonly NodeOption[], trimmedEditStateKey: string): readonly NodeOption[] {
  const alreadyListed = inputOptions.some(option => option.value === trimmedEditStateKey);
  if (!trimmedEditStateKey || alreadyListed) return inputOptions;
  return [
    { label: t('pipelines.flowEditor.hitlNode.notInState', '{{key}} (not in state)', { key: trimmedEditStateKey }), value: trimmedEditStateKey },
    ...inputOptions,
  ];
}

/** One `{action.value: options}` lookup, computed once per render instead of a per-row ternary — same complexity-budget reason as the pure functions above. */
function buildRouteOptionsByAction(
  editRouteOptions: readonly NodeOption[],
  nodeOptions: readonly NodeOption[],
): Readonly<Record<HitlAction['value'], readonly NodeOption[]>> {
  return { approve: nodeOptions, edit: editRouteOptions, reject: nodeOptions };
}

export interface HITLNodeHandlesProps {
  readonly isRunningPipeline: boolean;
  readonly disabled: boolean;
  readonly isTargetConnectable: boolean;
  readonly isPerforming: boolean;
}

/** Extracted purely to keep `HITLNode`'s own cyclomatic complexity under the §3.5 budget (12) — same technique `./AgentNode.tsx`'s `AgentNodeHandles` uses. */
export function HITLNodeHandles(props: HITLNodeHandlesProps): ReactNode {
  const { isRunningPipeline, disabled, isTargetConnectable, isPerforming } = props;
  return (
    <>
      <CustomHandle
        type="target"
        id="hitlNode"
        isConnectable={!isRunningPipeline && isTargetConnectable && !disabled}
        isRunningPipeline={isRunningPipeline}
        isPerforming={isPerforming}
      />
      {HITL_ACTIONS.map((action, index) => (
        <CustomHandle
          key={action.value}
          type="source"
          id={`hitlNode_${action.value}`}
          label={action.label}
          isConnectable={!isRunningPipeline && !disabled}
          isRunningPipeline={isRunningPipeline}
          isPerforming={isPerforming}
          style={{ left: `calc(25% + ${index * 25}%)` }}
        />
      ))}
    </>
  );
}

export interface HITLRouteRowProps {
  readonly action: HitlAction;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly NodeOption[];
  readonly disabled: boolean;
  readonly error: string;
}

/** Extracted purely to keep `HITLNode`'s own cyclomatic complexity under the §3.5 budget (12) — one "Router mapping" accordion row. */
export function HITLRouteRow(props: HITLRouteRowProps): ReactNode {
  const { action, value, onChange, options, disabled, error } = props;
  const styles = hitlNodeStyles();
  return (
    <Box
      sx={styles.controlGroup}
      className="nopan nodrag"
    >
      <HeadingChip label={action.chipLabel} />
      <SingleSelect
        sx={styles.routeSelect}
        label={t('pipelines.flowEditor.hitlNode.route', 'Route')}
        value={value}
        onChange={onChange}
        options={[...options]}
        disabled={disabled}
        error={error}
      />
    </Box>
  );
}

export interface HitlNodeStyles {
  readonly section: SxProps<Theme>;
  readonly accordion: SxProps<Theme>;
  readonly accordionSummary: SxProps<Theme>;
  readonly accordionTitle: SxProps<Theme>;
  readonly accordionDetails: SxProps<Theme>;
  readonly controlGroup: SxProps<Theme>;
  readonly inputSelectTooltipWrapper: SxProps<Theme>;
  readonly routeSelect: SxProps<Theme>;
  readonly validationText: SxProps<Theme>;
  readonly editStateKeyRow: SxProps<Theme>;
}

export function hitlNodeStyles(): HitlNodeStyles {
  return {
    section: (theme: Theme) => ({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.25),
      width: '100%',
      marginBottom: theme.spacing(2),
    }),
    accordion: (theme: Theme) => ({ background: theme.vars.palette.background.tabPanel }),
    accordionSummary: (theme: Theme) => ({
      background: theme.vars.palette.background.userInputBackground,
      borderRadius: theme.vars.shape.radiusMd,
      minHeight: theme.spacing(4),
      marginBottom: theme.spacing(1.5),
    }),
    accordionTitle: (theme: Theme) => ({ color: theme.vars.palette.text.secondary }),
    accordionDetails: { paddingLeft: 0, marginTop: '.5rem' },
    controlGroup: (theme: Theme) => ({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1), width: '100%' }),
    inputSelectTooltipWrapper: { display: 'block', width: '100%' },
    routeSelect: { marginBottom: 0 },
    validationText: { width: '100%' },
    // Same shape as `controlGroup` plus a bottom margin — a single merged
    // theme-callback instead of an `sx={[a, b]}` array (Box's `sx`
    // array-overload does not accept a nested `SxProps<Theme>`-typed
    // element, only concrete style-object/callback entries).
    editStateKeyRow: (theme: Theme) => ({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1),
      width: '100%',
      marginBottom: theme.spacing(2),
    }),
  };
}

const EMPTY_ROUTES: Readonly<Record<string, string>> = {};

/** `FlowEditorContext`, defaulted once — see `../AgentNode.tsx`'s identical constant for the full rationale. */
const EMPTY_FLOW_EDITOR_CONTEXT: FlowEditorContextValue = {
  yamlJsonObject: {},
  setFlowNodes: () => {},
  setFlowEdges: () => {},
  setYamlJsonObject: () => {},
};

export interface UseHITLNodeModelArgs {
  readonly id: string;
  readonly llmSettings: AiAssistantLlmSettings | null | undefined;
}

export interface HITLNodeModel {
  readonly isRunningPipeline: boolean;
  readonly disabled: boolean;
  readonly entryPointYamlJsonObject: Readonly<Record<string, unknown>>;
  readonly isEntrypoint: boolean;
  readonly isTargetConnectable: boolean;
  readonly resolvedLlmSettings: AiAssistantLlmSettings | null;
  readonly inputSelectDisabled: boolean;
  readonly inputSelectTooltip: string;
  readonly inputSelectTooltipTitle: string;
  readonly userMessageType: string;
  readonly userMessageValue: string;
  readonly simpleLLMDisabled: boolean;
  readonly handleUserMessageMappingChange: (variable: string, next: { readonly type?: string; readonly value: unknown }) => void;
  readonly routes: Readonly<Record<string, string>>;
  readonly routeOptionsByAction: Readonly<Record<HitlAction['value'], readonly NodeOption[]>>;
  readonly canEditRoute: boolean;
  readonly routeErrorText: string;
  readonly handleRouteSelectChange: (action: HitlAction['value']) => (value: string) => void;
  readonly editStateKey: string;
  readonly editStateKeyOptions: readonly NodeOption[];
  readonly editStateKeySelectDisabled: boolean;
  readonly handleEditStateKeyChange: (value: string) => void;
  readonly isEditRouteInvalid: boolean;
  readonly editRouteErrorMessage: string;
}

/**
 * Every piece of `HITLNode`'s own derived state/handlers, gathered behind
 * one custom hook — kept out of `HITLNode`'s own function body purely to
 * stay under the §3.5 complexity budget (12): each `useMemo`/`useCallback`
 * call already scopes its OWN branches independently, but the many plain
 * `??`/`||`/ternary variable derivations that sat directly in the
 * component's body (not wrapped in a hook) still summed against it. Moving
 * the whole derivation surface into this sibling hook function gives it its
 * own independent budget instead, leaving `HITLNode` itself pure
 * hook-call-and-render.
 */
export function useHITLNodeModel(args: UseHITLNodeModelArgs): HITLNodeModel {
  const { id, llmSettings } = args;

  const edges = useEdges();
  const flowEditorContext = useContext(FlowEditorContext) ?? EMPTY_FLOW_EDITOR_CONTEXT;
  const { yamlJsonObject, setYamlJsonObject, setFlowEdges } = flowEditorContext;
  const isRunningPipeline = Boolean(flowEditorContext.isRunningPipeline);
  const disabled = Boolean(flowEditorContext.disabled);
  const resolvedLlmSettings = useNodeAiAssistantConfig(llmSettings as Record<string, unknown> | null | undefined) as AiAssistantLlmSettings | null;
  const inputOptions = useInputOptions();

  const yamlNode = useMemo(() => yamlJsonObject.nodes?.find(node => node.id === id), [id, yamlJsonObject.nodes]);

  const nodeOptions = useNodeOptions(node => node.id !== id, true);
  const editRouteOptions = useMemo(
    () => nodeOptions.filter(option => option.value !== FlowEditorConstants.PipelineNodeTypes.End),
    [nodeOptions],
  );
  const routeOptionsByAction = useMemo(() => buildRouteOptionsByAction(editRouteOptions, nodeOptions), [editRouteOptions, nodeOptions]);

  const isTargetConnectable = useMemo(() => !edges.find(edge => edge.target === id), [edges, id]);

  const userMessage = useMemo(
    () => yamlNode?.['user_message'] as { readonly type?: string; readonly value?: string } | undefined,
    [yamlNode],
  );
  const userMessageType = userMessage?.type ?? 'fixed';
  const userMessageValue = userMessage?.value ?? '';
  const inputSelectTooltip = t(
    'pipelines.flowEditor.hitlNode.inputSelectTooltip',
    'Select state variables to reference in the User message. Available only when the User message type is set to F-String.',
  );
  const derivedInputState = useMemo(() => {
    const disabledByMessageType = userMessageType !== 'fstring';
    return {
      inputSelectDisabled: disabledByMessageType || isRunningPipeline || disabled,
      inputSelectTooltipTitle: disabledByMessageType ? inputSelectTooltip : '',
    };
  }, [userMessageType, isRunningPipeline, disabled, inputSelectTooltip]);

  const handleUserMessageMappingChange = useCallback(
    (_variable: string, next: { readonly type?: string; readonly value: unknown }) => {
      const nextType = next.type ?? 'fixed';
      const updates: Record<string, unknown> =
        userMessageType === 'fstring' && nextType !== 'fstring'
          ? { user_message: { type: nextType, value: next.value }, input: [] }
          : { user_message: { type: nextType, value: next.value } };
      batchUpdateYamlNode(id, updates, yamlJsonObject, setYamlJsonObject);
    },
    // baseline's own deps array (faithfully ported) -- FlowEditorContext's yamlJsonObject/setYamlJsonObject are not memoized upstream, matching this batch's established `useLLMInputMapping.ts` precedent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, setYamlJsonObject, yamlJsonObject, userMessageType],
  );

  const routes = useMemo(() => (yamlNode?.routes as Readonly<Record<string, string>> | undefined) ?? EMPTY_ROUTES, [yamlNode]);

  const handleRouteChange = useCallback(
    (action: HitlAction['value'], value: string) => {
      const newRoutes = { ...routes, [action]: value };
      batchUpdateYamlNode(id, { routes: newRoutes, transition: undefined }, yamlJsonObject, setYamlJsonObject);
      setFlowEdges(prevEdges => buildRouteEdges(prevEdges, id, action, value, yamlJsonObject));
    },
    // baseline's own deps array (faithfully ported) -- FlowEditorContext's yamlJsonObject/setYamlJsonObject are not memoized upstream, matching this batch's established `useLLMInputMapping.ts` precedent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, routes, setFlowEdges, setYamlJsonObject, yamlJsonObject],
  );
  const handleRouteSelectChange = useCallback(
    (action: HitlAction['value']) => (value: string) => handleRouteChange(action, value),
    [handleRouteChange],
  );

  const editStateKey = yamlNode?.edit_state_key ?? '';
  const trimmedEditStateKey = useMemo(() => editStateKey.trim(), [editStateKey]);
  const editStateKeyOptions = useMemo(
    () => computeEditStateKeyOptions(inputOptions, trimmedEditStateKey),
    [inputOptions, trimmedEditStateKey],
  );
  const editRouteErrorMessage = t(
    'pipelines.flowEditor.hitlNode.editRouteRequiresKey',
    'Provide an edit state key before using the Edit route.',
  );
  const derivedRouteState = useMemo(() => {
    const hasConfiguredEditRoute = Boolean(routes['edit']);
    const isEditRouteInvalid = hasConfiguredEditRoute && trimmedEditStateKey.length === 0;
    return {
      canEditRoute: hasConfiguredEditRoute || trimmedEditStateKey.length > 0,
      isEditRouteInvalid,
      routeErrorText: isEditRouteInvalid ? editRouteErrorMessage : '',
    };
  }, [routes, trimmedEditStateKey, editRouteErrorMessage]);

  const handleEditStateKeyChange = useCallback(
    (value: string) => {
      updateYamlNode(id, 'edit_state_key', value, yamlJsonObject, setYamlJsonObject);
    },
    // baseline's own deps array (faithfully ported) -- FlowEditorContext's yamlJsonObject/setYamlJsonObject are not memoized upstream, matching this batch's established `useLLMInputMapping.ts` precedent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, setYamlJsonObject, yamlJsonObject],
  );

  return {
    isRunningPipeline,
    disabled,
    entryPointYamlJsonObject: yamlJsonObject,
    isEntrypoint: yamlJsonObject.entry_point === id,
    isTargetConnectable,
    resolvedLlmSettings,
    inputSelectDisabled: derivedInputState.inputSelectDisabled,
    inputSelectTooltip,
    inputSelectTooltipTitle: derivedInputState.inputSelectTooltipTitle,
    userMessageType,
    userMessageValue,
    simpleLLMDisabled: isRunningPipeline || disabled,
    handleUserMessageMappingChange,
    routes,
    routeOptionsByAction,
    canEditRoute: derivedRouteState.canEditRoute,
    routeErrorText: derivedRouteState.routeErrorText,
    handleRouteSelectChange,
    editStateKey,
    editStateKeyOptions,
    editStateKeySelectDisabled: isRunningPipeline || disabled,
    handleEditStateKeyChange,
    isEditRouteInvalid: derivedRouteState.isEditRouteInvalid,
    editRouteErrorMessage,
  };
}
