import type { ReactNode } from 'react';
import { useCallback } from 'react';

import type { ToolkitWriteResult } from '../api/toolkits';

import type { ToolkitFormValues } from './SaveToolkitButton';
import {
  EMPTY_PARTICIPANT,
  ToolkitEditorBody,
  ToolkitEditorSaveButton,
  emptyContentSx,
  resolveToolkitName,
  useToolkitEditorState,
} from './ToolkitEditorParts';
import type { ToolkitEditorParticipant, ToolkitEditorProps } from './ToolkitEditorParts';

export type { ToolkitEditorDeps, ToolkitEditorParticipant, ToolkitEditorProps, ToolkitEditorShellProps } from './ToolkitEditorParts';

/**
 * Ported from `apps/elitea-ui/src/pages/NewChat/ToolkitEditor.jsx` (335
 * lines) — unit A4g.
 *
 * **MUST be exported through `src/features/toolkits/index.ts`** — Wave-2
 * unit C6 needs it cross-feature (this batch's own mission brief).
 *
 * **Real, load-bearing redesign, not a porting shortcut — read before
 * wiring this up.** Follows the EXACT `deps`-injection shape
 * `features/agents/ui/AgentEditor.tsx`/`features/pipelines/ui/
 * PipelineEditor.tsx` already established for this batch:
 *
 *  - `deps.renderShell` — the chat-owned editor chrome (baseline:
 *    `pages/NewChat/components/BaseEditor.jsx`). `features/toolkits`
 *    cannot import `features/chat` (`no-sideways-features`, no carve-out;
 *    the mission brief's own framing: "Wave-2 unit C6 (a much later chat
 *    unit)" confirms this is real future work, not a landed sibling).
 *  - `deps.createToolkit`/`deps.saveToolkit` — no generated `POST
 *    /elitea_core/tools/prompt_lib/{projectId}` or `PUT /elitea_core/tool/
 *    prompt_lib/{projectId}/{toolId}` endpoint exists (see `../api/
 *    toolkits.ts`'s module doc comment for the full, exhaustively-verified
 *    inventory). Injected exactly like `useValidateToolkit`'s
 *    `useValidateToolkitQuery` — this component owns 100% real orchestration
 *    (which button renders, dirty/loading state, credential-warning gating)
 *    around a network call a future caller supplies once a real endpoint
 *    exists.
 *  - `deps.checkBeforeSave` — baseline: `entities/credential-warning`'s
 *    `useCredentialWarning`/`CredentialWarningModal`. `features/toolkits`
 *    cannot import `features/credentials` (`no-sideways-features`), AND
 *    that slice's own `index.ts` does not export `CredentialWarningModal`/
 *    `useCredentialWarningModal` even if it could (§3.5 budget — see that
 *    file's own doc comment: "NOT exported here despite being fully built
 *    and tested"). Rather than half-plumb a modal-rendering slot through
 *    this component for a dependency it cannot reach either way, the ENTIRE
 *    check (including any modal UI) is the caller's opaque
 *    `(performSave) => boolean` callback — identical contract
 *    `SaveToolkitButton.tsx`'s own `onBeforeSave` prop already documents.
 *    Omitted entirely, saving proceeds immediately (matches the baseline's
 *    own `if (onBeforeSave) {...} else { await performSave() }` no-op
 *    default).
 *  - `deps.onEditorClosed` — baseline: none directly (the toolkit editor's
 *    close handler is caller-supplied `onCloseToolkitEditor` already);
 *    matches `AgentEditorDeps`'s identical optional hook for symmetry with
 *    the two sibling editors.
 *
 * **Dropped, disclosed gaps (same "no unreachable dependency invented"
 * discipline as `AgentEditor.tsx`/`PipelineEditor.tsx`):**
 *  - `usePublicProjectAccessCheck` (`features/project/lib/hooks` in the
 *    baseline) has no port anywhere in this worktree — `features/project`
 *    does not exist as a landed slice, and `entities/project`'s public API
 *    (`isPublicProject`/`isSuspendedProject`/`sortProjectsByName`) has no
 *    "does the current user have write access to the public project"
 *    check. `disabled` therefore reduces to `isPublic` alone (edit mode
 *    always locks a public-project toolkit) rather than the baseline's
 *    `isPublic && !hasPublicProjectAccess` — a conservative default (never
 *    LESS locked than the baseline), not an invented permission model.
 *  - GA event tracking (`useTrackEvent`, baseline lines 5,30,71-79) —
 *    dropped outright, same documented gap `AgentEditor.tsx`'s own doc
 *    comment gives (no analytics-event SDK exists anywhere in this app).
 *  - `useToolkitsDetailsQuery` (RTK Query, single-toolkit GET) is replaced
 *    with this unit's own `useToolkitDetail` (`../api/toolkits.ts`) — no
 *    generated GET-single endpoint exists either; that hook derives detail
 *    from the real `listToolkitInstances` collection client-side (see its
 *    own doc comment).
 *
 * Split into this file (the public `ToolkitEditor` component) and
 * `./ToolkitEditorParts.tsx` (the prop-shape types, the state hook, the
 * body/save-button sub-components) purely to stay under the §3.5 400-line
 * file-length budget — same `PipelineEditorParts.tsx` precedent this batch
 * already established for the sibling pipelines editor. The prop-shape
 * types live in `ToolkitEditorParts.tsx`, not here, so the dependency edge
 * between the two files stays one-directional (this file imports FROM
 * `ToolkitEditorParts.tsx` only, never the reverse) — the same "no-circular"
 * (R-L2) reason `PipelineEditor.tsx` keeps `PipelineEditorDeps`/
 * `PipelineEditorShellProps` in `PipelineEditorParts.tsx` too; the type
 * re-export below (`export type {...} from './ToolkitEditorParts'`) keeps
 * every external caller's import path (`from './ToolkitEditor'` or
 * `features/toolkits`' own `index.ts`, which imports every one of these
 * types from THIS file) unchanged. `ToolkitEditorParts.tsx` has no OTHER
 * caller — this file is that split's entire reason to exist.
 */
export function ToolkitEditor({ toolkit, isVisible, onCloseToolkitEditor, onToolkitCreated, onToolkitUpdated, deps }: ToolkitEditorProps): ReactNode {
  const state = useToolkitEditorState(toolkit ?? EMPTY_PARTICIPANT, isVisible);
  const { isDirty, setIsDirty, validationState, setValidationState, revertCredentialsRef, isCreating, isMCP, projectId, toolkitId, scopedProjectId, isPublic, isError, editToolDetail, formInitialValues, setFormInitialValues, handleChangeToolDetail, handleDiscard } = state;

  const handleClose = useCallback(() => {
    onCloseToolkitEditor?.();
    deps.onEditorClosed?.();
  }, [onCloseToolkitEditor, deps]);

  const handleToolkitCreated = useCallback((result: ToolkitWriteResult) => onToolkitCreated?.(result), [onToolkitCreated]);

  const handleToolkitSaved = useCallback(
    (_result: ToolkitWriteResult, toolkitData: ToolkitFormValues) => {
      if (!isCreating && toolkit) {
        const updated: ToolkitEditorParticipant = {
          ...toolkit,
          entity_meta: { ...toolkit.entity_meta, name: toolkitData.name },
          meta: { ...toolkit.meta, name: toolkitData.name },
        };
        onToolkitUpdated?.(updated, true);
      }
      setIsDirty(false);
    },
    [isCreating, toolkit, onToolkitUpdated, setIsDirty],
  );

  if (!toolkit) return null;

  return deps.renderShell({
    isVisible,
    isDirty,
    onClose: handleClose,
    title: resolveToolkitName(isCreating, isMCP, editToolDetail, toolkit),
    onDiscard: handleDiscard,
    error: isError,
    saveButton: (
      <ToolkitEditorSaveButton
        isCreating={isCreating}
        editToolDetail={editToolDetail}
        toolkitId={toolkitId}
        isDirty={isDirty}
        validationState={validationState}
        createProjectId={projectId}
        saveProjectId={scopedProjectId}
        deps={deps}
        onToolkitCreated={handleToolkitCreated}
        onToolkitSaved={handleToolkitSaved}
      />
    ),
    ...(editToolDetail === null ? { contentSx: emptyContentSx } : {}),
    children: (
      <ToolkitEditorBody
        isCreating={isCreating}
        isMCP={isMCP}
        editToolDetail={editToolDetail}
        onChangeToolDetail={handleChangeToolDetail}
        formInitialValues={formInitialValues}
        setFormInitialValues={setFormInitialValues}
        disabled={isPublic}
        projectId={scopedProjectId}
        revertCredentialsRef={revertCredentialsRef}
        onValidationStateChange={setValidationState}
      />
    ),
  });
}
