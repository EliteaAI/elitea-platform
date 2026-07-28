import { useCallback, useEffect, useMemo, useRef } from 'react';

import { load as loadYaml } from 'js-yaml';

import { applicationCreationSchema } from '@/entities/application-form';
import { LATEST_VERSION_NAME } from '@/entities/version';
import { useGetApplicationVersionDetail, useGetPublicApplication } from '@/shared/api/generated/applications/applications';
import type { ApplicationCreatedResponse, ApplicationVersionDetail } from '@/shared/api/generated/model';
import { ChatParticipantType } from '@/shared/lib/chat';

import { doLayout } from '../lib/flow-editor/helpers/layout.helpers';
import * as ParsePipelineHelpers from '../lib/flow-editor/helpers/parsePipeline.helpers';
import type { YamlPipelineDocument } from '../lib/flow-editor/helpers/pipelineFlow.types';
import type { FlowEdge, FlowNode } from '../lib/flow-editor/reactFlowTypes';
import type { usePipelineEditorCreate } from '../lib/usePipelineEditorCreate';
import { usePipelineEditorStore } from '../model/pipelineEditorStore';
import { usePipelineYamlStore } from '../model/pipelineYamlStore';

/**
 * `PipelineEditor.jsx`'s top-level `useEffect`/data-fetching plumbing,
 * split into small named hooks — one component owning all of it blows past
 * §3.5's cyclomatic-complexity budget (12) by roughly 4x. Matches this
 * batch's own established precedent for exactly this situation
 * (`ui/useFlowEditorLifecycle.ts`, sibling unit A2k's split of
 * `FlowEditor.jsx`'s seven effects; `pages/pipelines/lib/
 * useEditPipelineData.ts`, unit A2m's split of `EditPipeline.tsx`'s fetch
 * logic). See `PipelineEditor.tsx`'s own module doc comment for the
 * zustand-store ownership rationale these hooks write into.
 */

/** `pipeline_settings.nodes` — a permissive `Record<string, unknown>` on the wire (`PipelineSettings` zod schema). Narrowed defensively (array check only) since it is only ever fed to `doLayout`'s optional "previously measured heights" hint, which itself falls back safely per-node when a match isn't found. */
function readSavedNodes(pipelineSettings: Readonly<Record<string, unknown>> | undefined): readonly FlowNode[] {
  const nodes = pipelineSettings?.nodes;
  return Array.isArray(nodes) ? (nodes as readonly FlowNode[]) : [];
}

export interface UsePipelineVersionQueryArgs {
  readonly projectId: string | undefined;
  readonly pipelineId: string | number | undefined;
  readonly versionId: string | number | undefined;
  readonly isVisible: boolean;
  readonly isCreateMode: boolean;
  readonly isPublishedPipeline: boolean;
}

export interface UsePipelineVersionQueryResult {
  readonly versionDetails: ApplicationVersionDetail | undefined;
  readonly fetchError: unknown;
  readonly refetchPrivate: () => void;
}

/** Split out purely to keep `usePipelineVersionQuery`'s own branch count under the oxlint complexity budget. */
function isPrivateVersionQueryEnabled(args: UsePipelineVersionQueryArgs): boolean {
  const { isVisible, projectId, pipelineId, versionId, isCreateMode, isPublishedPipeline } = args;
  if (!isVisible || isCreateMode || isPublishedPipeline) return false;
  return Boolean(projectId && pipelineId && versionId);
}

/** Split out purely to keep `usePipelineVersionQuery`'s own branch count under the oxlint complexity budget. */
function isPublicVersionQueryEnabled(args: UsePipelineVersionQueryArgs): boolean {
  const { isVisible, pipelineId, isCreateMode, isPublishedPipeline } = args;
  if (!isVisible || isCreateMode || !isPublishedPipeline) return false;
  return Boolean(pipelineId);
}

/** Split out purely to keep `usePipelineVersionQuery`'s own branch count under the oxlint complexity budget. */
function selectVersionDetails(
  isPublishedPipeline: boolean,
  publicVersionDetails: ApplicationVersionDetail | undefined,
  privateVersionDetails: ApplicationVersionDetail | undefined,
): ApplicationVersionDetail | undefined {
  return isPublishedPipeline ? publicVersionDetails : privateVersionDetails;
}

/** `PipelineEditor.jsx:219-244` — fetch the pipeline's version detail from whichever of the two real endpoints applies (private vs. published-to-`public` project). */
export function usePipelineVersionQuery(args: UsePipelineVersionQueryArgs): UsePipelineVersionQueryResult {
  const { projectId, pipelineId, versionId, isPublishedPipeline } = args;

  const privateQuery = useGetApplicationVersionDetail(projectId ?? '', Number(pipelineId ?? 0), Number(versionId ?? 0), {
    query: { enabled: isPrivateVersionQueryEnabled(args) },
  });
  const publicQuery = useGetPublicApplication(Number(pipelineId ?? 0), LATEST_VERSION_NAME, {
    query: { enabled: isPublicVersionQueryEnabled(args) },
  });

  const publicVersionDetails = (publicQuery.data?.data as { readonly version_details?: ApplicationVersionDetail } | undefined)?.version_details;
  const privateVersionDetails = privateQuery.data?.data as ApplicationVersionDetail | undefined;
  const versionDetails = selectVersionDetails(isPublishedPipeline, publicVersionDetails, privateVersionDetails);
  const fetchError = isPublishedPipeline ? publicQuery.error : privateQuery.error;

  const refetchPrivate = useCallback(() => {
    void privateQuery.refetch();
  }, [privateQuery]);

  return { versionDetails, fetchError, refetchPrivate };
}

export interface UsePipelineIdentityResetArgs {
  readonly isCreateMode: boolean;
  readonly pipelineEntityId: string | number | undefined;
  readonly onReset: () => void;
}

/** `PipelineEditor.jsx:192-210` — reset local dirty/tab state and both zustand stores whenever the create-mode flag or the pipeline identity changes. */
export function usePipelineIdentityReset({ isCreateMode, pipelineEntityId, onReset }: UsePipelineIdentityResetArgs): void {
  useEffect(() => {
    onReset();
    usePipelineYamlStore.getState().resetPipelineYaml();
    usePipelineEditorStore.getState().resetPipelineEditor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreateMode, pipelineEntityId]);
}

export interface UsePipelineVersionSyncArgs {
  readonly isCreateMode: boolean;
  readonly versionDetails: ApplicationVersionDetail | undefined;
  readonly versionId: string | number | undefined;
}

/** `PipelineEditor.jsx:345-405` — parse the loaded version's `instructions` YAML, lay out the graph (using any previously-saved node positions), and push both into the zustand stores. Guarded against re-initializing on an unchanged `instructions` string (baseline comment: prevents toolkit-association refetches, which only touch `tools[]`, from clobbering in-progress flow-editor edits). */
export function usePipelineVersionSync({ isCreateMode, versionDetails, versionId }: UsePipelineVersionSyncArgs): void {
  const lastInitializedInstructionsRef = useRef<string | null>(null);

  useEffect(() => {
    if (isCreateMode || !versionDetails?.id) return;
    if (String(versionDetails.id) !== String(versionId)) return;

    const instructions = versionDetails.instructions ?? '';
    if (instructions === lastInitializedInstructionsRef.current) return;
    lastInitializedInstructionsRef.current = instructions;

    let parsedYamlJson: YamlPipelineDocument | undefined;
    try {
      parsedYamlJson = loadYaml(instructions) as YamlPipelineDocument | undefined;
    } catch {
      return;
    }

    const { nodes: parsedNodes, edges: parsedEdges } = ParsePipelineHelpers.parseYaml(parsedYamlJson);
    const savedNodes = readSavedNodes(versionDetails.pipeline_settings);
    // `FlowGraphNode`/`FlowGraphEdge` (A2c, structural) are a wider struct
    // than `@xyflow/react`'s `Node`/`Edge` generics (`reactFlowTypes.ts`'s
    // own doc comment: "still structurally compatible... wherever this
    // file's types are passed into A2c's helpers"), so the reverse
    // direction here is the same structural assignment, made explicit.
    const { nodes, edges } = doLayout({
      nodes: parsedNodes as unknown as readonly FlowNode[],
      edges: parsedEdges as unknown as readonly FlowEdge[],
      flowNodes: savedNodes,
    });

    usePipelineYamlStore.getState().initPipelineYaml({
      yamlCode: instructions,
      yamlJsonObject: parsedYamlJson ?? {},
    });
    usePipelineEditorStore.getState().resetPipelineEditor();
    usePipelineEditorStore.getState().setNodes(nodes);
    usePipelineEditorStore.getState().setEdges(edges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreateMode, versionDetails, versionId]);
}

export interface PipelineEditorHandleLike {
  readonly onRcvAgentEvent: (event: unknown) => void;
  readonly deleteAllRunNodes: () => void;
  readonly onStopRun: (isChat: boolean) => void;
}

export interface UsePipelineEditorHandleArgs<TEditorPanelHandle extends { readonly onRcvAgentEvent: (event: unknown) => void; readonly deleteAllRunNodes: () => void; readonly onStopRun: () => void }> {
  readonly editorPanelRef: { readonly current: TEditorPanelHandle | null };
  readonly pipelineId: string | number | undefined;
  readonly activeParticipantId: string | number | undefined;
  readonly stopRunOnNodeStop: ((stop: boolean) => void) | undefined;
}

/** `PipelineEditor.jsx:156-186` — the three imperative-ref callbacks exposed to the chat host, extracted purely to keep `PipelineEditor` under the complexity budget. */
export function usePipelineEditorHandle<TEditorPanelHandle extends { readonly onRcvAgentEvent: (event: unknown) => void; readonly deleteAllRunNodes: () => void; readonly onStopRun: () => void }>({
  editorPanelRef,
  pipelineId,
  activeParticipantId,
  stopRunOnNodeStop,
}: UsePipelineEditorHandleArgs<TEditorPanelHandle>): PipelineEditorHandleLike {
  const onRcvAgentEvent = useCallback(
    (event: unknown) => {
      if (pipelineId !== undefined && activeParticipantId === pipelineId) {
        editorPanelRef.current?.onRcvAgentEvent(event);
      }
    },
    [editorPanelRef, pipelineId, activeParticipantId],
  );
  const deleteAllRunNodes = useCallback(() => {
    editorPanelRef.current?.deleteAllRunNodes();
  }, [editorPanelRef]);
  const onStopRun = useCallback(
    (isChat: boolean) => {
      if (isChat) editorPanelRef.current?.onStopRun();
      else stopRunOnNodeStop?.(true);
    },
    [editorPanelRef, stopRunOnNodeStop],
  );

  return useMemo(() => ({ onRcvAgentEvent, deleteAllRunNodes, onStopRun }), [onRcvAgentEvent, deleteAllRunNodes, onStopRun]);
}

export interface UsePipelineEditorActionsArgs {
  readonly isCreateMode: boolean;
  readonly pipelineEntityId: string | number | undefined;
  readonly create: ReturnType<typeof usePipelineEditorCreate>;
  readonly onPipelineCreated: ((result: ApplicationCreatedResponse) => void) | undefined;
  readonly onPipelineSaved: ((savedFormData: unknown) => void) | undefined;
  readonly onAttachmentToolChange: ((pipelineId: string | number | undefined) => void) | undefined;
  readonly refetchPrivate: () => void;
  readonly setIsDirty: (dirty: boolean) => void;
  readonly setIsYamlDirty: (dirty: boolean) => void;
}

export interface UsePipelineEditorActionsResult {
  readonly canSaveCreate: boolean;
  readonly handleCreateSubmit: () => Promise<void>;
  readonly handleDiscard: () => void;
  readonly handleSaveSuccess: (savedFormData: unknown) => void;
  readonly handleAttachmentToolChange: () => void;
}

/** `PipelineEditor.jsx:253-271,411-448` — the create-submit/discard/save-success/attachment-tool-change handlers, extracted purely to keep `PipelineEditor` under the complexity budget. */
export function usePipelineEditorActions({
  isCreateMode,
  pipelineEntityId,
  create,
  onPipelineCreated,
  onPipelineSaved,
  onAttachmentToolChange,
  refetchPrivate,
  setIsDirty,
  setIsYamlDirty,
}: UsePipelineEditorActionsArgs): UsePipelineEditorActionsResult {
  const handlePipelineCreated = useCallback(
    (result: ApplicationCreatedResponse) => {
      onPipelineCreated?.({ participantType: ChatParticipantType.Pipelines, ...result } as ApplicationCreatedResponse);
    },
    [onPipelineCreated],
  );

  const handleCreateSubmit = useCallback(async () => {
    const result = await create.submit();
    if (result) handlePipelineCreated(result);
  }, [create, handlePipelineCreated]);

  const handleDiscard = useCallback(() => {
    setIsDirty(false);
    setIsYamlDirty(false);
    usePipelineYamlStore.getState().resetPipelineYaml();
    usePipelineEditorStore.getState().resetPipelineEditor();
  }, [setIsDirty, setIsYamlDirty]);

  const handleSaveSuccess = useCallback(
    (savedFormData: unknown) => {
      setIsDirty(false);
      setIsYamlDirty(false);
      onAttachmentToolChange?.(pipelineEntityId);
      onPipelineSaved?.(savedFormData);
    },
    [onAttachmentToolChange, onPipelineSaved, pipelineEntityId, setIsDirty, setIsYamlDirty],
  );

  const handleAttachmentToolChange = useCallback(() => {
    onAttachmentToolChange?.(pipelineEntityId);
    if (!isCreateMode) refetchPrivate();
  }, [isCreateMode, onAttachmentToolChange, pipelineEntityId, refetchPrivate]);

  const canSaveCreate = useMemo(() => applicationCreationSchema.safeParse(create.values).success, [create.values]);

  return { canSaveCreate, handleCreateSubmit, handleDiscard, handleSaveSuccess, handleAttachmentToolChange };
}

function noopConversationStartersSync(_onChange: ((starters: readonly string[]) => void) | undefined): void {
  // No-op default — see `PipelineEditorDeps.useConversationStartersSync`'s doc comment.
}

/** `useConversationStartersSync ?? noop`, called unconditionally — extracted purely to keep `PipelineEditor`'s own branch count under the oxlint complexity budget (the `??` resolution itself, not the rules-of-hooks shape, which is unchanged: still exactly one hook call per render). */
export function usePipelineConversationStartersSync(
  useConversationStartersSync: ((onChange: ((starters: readonly string[]) => void) | undefined) => void) | undefined,
  onConversationStartersChange: ((starters: readonly string[]) => void) | undefined,
): void {
  const useSync = useConversationStartersSync ?? noopConversationStartersSync;
  useSync(onConversationStartersChange);
}
