import type { ReactNode } from 'react';

import Typography from '@mui/material/Typography';

import { AgentEditor } from '@/features/agents';
import { PipelineEditor } from '@/features/pipelines';
import { ToolkitEditor } from '@/features/toolkits';
import ChatPage from '@/pages/chat';
import { t } from '@/shared/i18n';
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';

import { rejectToolkitWrite, toCreatedResult } from './ChatWithEditors.helpers';
import { useChatWithEditors } from './ChatWithEditors.hooks';
import { renderAgentEditorShell, renderPipelineEditorShell, renderToolkitEditorShell } from './EditorShell';

/**
 * `ChatWithEditors` — the real composition root this whole unit exists to
 * build. `src/features/pipelines/ui/PipelineEditor.tsx`'s own module doc
 * comment (its "STILL UNREACHABLE from the live app" section) already
 * diagnosed the exact gap this file closes: `AgentEditor`/`PipelineEditor`/
 * `ToolkitEditor` are fully built and tested but nothing in the live app
 * mounts them, because `processes/chat/model/useEditorMutex.ts` (the
 * intended orchestrator) was itself never called anywhere, and
 * `widgets/chat-box/ui/ChatBox.helpers.ts`'s `buildAgentEditorProps` wired
 * `onShowAgentEditor`/`onShowPipelineEditor`/`onCloseAgentEditor`/
 * `onClosePipelineEditor` as literal no-ops.
 *
 * **Why this lives in `processes/chat/ui/`, not `widgets/chat-box/` —
 * architectural correction, not a stylistic choice.** `.dependency-
 * cruiser.cjs`'s `LAYERS_ABOVE` table gives `processes: ['app']`: only
 * `src/app/` may import from `src/processes/`, but `processes/` itself may
 * legally import `widgets/`, `pages/`, `features/`, `entities/`, `shared/`
 * — everything BELOW it. A composition root that needs `widgets/chat-box`
 * (via `pages/chat`), `features/agents`, `features/pipelines`,
 * `features/toolkits`, AND `processes/chat/model/useEditorMutex` all at
 * once therefore belongs here, one layer above every one of them — mounting
 * it from `widgets/chat-box/ui/ChatBox.tsx` directly would be the exact
 * upward import `no-upward-from-widgets` forbids. `src/routes/_shell/
 * chat.tsx` (unconstrained by any layer regex — verified against
 * `.dependency-cruiser.cjs`'s four `from` patterns, none of which match
 * `^src/routes/`) renders THIS component instead of `pages/chat`'s
 * `ChatPage` directly; `ChatPage` itself is still rendered here, as this
 * component's main child, extended with one new optional `editorCallbacks`
 * prop (`pages/chat/index.tsx`'s own doc comment) that reaches all the way
 * down to `features/chat-input`'s `NewChatInput` through `ChatBox`'s
 * matching new optional prop.
 *
 * All the real hook wiring (`useEditAgent`/`useAgentCreation`/
 * `useEditPipeline`/`usePipelineCreation`/`useEditToolkit`/
 * `useToolkitCreation`/`useEditorMutex`, plus every disclosed gap —
 * Canvas/Artifact stubs, the agent-participant-resync gap, the toolkit
 * create/save-mutation gap) lives in `./ChatWithEditors.hooks.ts`, split
 * out purely to keep this file itself under the §3.5 400-line budget; read
 * that file's own doc comments for the full disclosure. This file is pure
 * composition: render `<ChatPage>` plus the three editors, each gated on
 * its own `shared/lib/editorState` flag, plus the two confirm dialogs
 * (`EditorShell`'s own discard-confirm is a separate, already-built
 * concern — the dialog rendered directly here is `useEditorMutex`'s own
 * "another editor is open" queue-confirm).
 */
export function ChatWithEditors(): ReactNode {
  const {
    isEditingAgent,
    isEditingPipeline,
    isEditingToolkit,
    agentForEditor,
    editAgent,
    agentCreation,
    editPipeline,
    pipelineCreation,
    editToolkit,
    toolkitCreation,
    mutex,
    handleShowAgentEditor,
    handleShowPipelineEditor,
  } = useChatWithEditors();

  return (
    <>
      <ChatPage
        editorCallbacks={{
          onShowAgentEditor: handleShowAgentEditor,
          onShowPipelineEditor: handleShowPipelineEditor,
          onCloseAgentEditor: editAgent.onCloseAgentEditor,
          onClosePipelineEditor: editPipeline.onClosePipelineEditor,
        }}
      />

      {isEditingAgent && (
        <AgentEditor
          agent={agentForEditor}
          isVisible={isEditingAgent}
          isCreateMode={editAgent.isCreateMode}
          onCloseAgentEditor={editAgent.onCloseAgentEditor}
          onAgentCreated={(result) => void agentCreation.onAgentCreated(toCreatedResult(result))}
          deps={{ renderShell: renderAgentEditorShell }}
        />
      )}

      {isEditingPipeline && (
        <PipelineEditor
          pipeline={editPipeline.editingPipeline}
          isVisible={isEditingPipeline}
          isCreateMode={editPipeline.isPipelineCreateMode}
          onClosePipelineEditor={editPipeline.onClosePipelineEditor}
          onPipelineCreated={(result) => pipelineCreation.onPipelineCreated(toCreatedResult(result))}
          deps={{ renderShell: renderPipelineEditorShell }}
        />
      )}

      {isEditingToolkit && (
        <ToolkitEditor
          toolkit={editToolkit.editingToolkit}
          isVisible={isEditingToolkit}
          onCloseToolkitEditor={editToolkit.onCloseToolkitEditor}
          onToolkitCreated={(result) => void toolkitCreation.onToolkitCreated(result)}
          deps={{
            renderShell: renderToolkitEditorShell,
            createToolkit: rejectToolkitWrite,
            saveToolkit: rejectToolkitWrite,
          }}
        />
      )}

      {/* `useEditorMutex`'s own "another editor is open" queue-and-confirm flow (its own doc comment) — distinct from `EditorShell`'s own discard-confirm, which guards a single editor's own close/discard action. */}
      <DeleteEntityModal
        open={mutex.openEditingAlert}
        onClose={mutex.onCloseEditorAlert}
        onConfirm={mutex.onConfirmCloseEditor}
        copy={{
          title: t('processes.chat.chatWithEditors.queueConfirmTitle', 'Another editor is open'),
          confirmText: t('processes.chat.chatWithEditors.queueConfirmConfirm', 'Discard & Continue'),
          cancelText: t('processes.chat.chatWithEditors.queueConfirmCancel', 'Cancel'),
        }}
        content={{
          custom: (
            <Typography variant="bodyMedium">
              {t(
                'processes.chat.chatWithEditors.queueConfirmContent',
                'Discard the changes in the current editor and open the one you selected instead?',
              )}
            </Typography>
          ),
        }}
        data-testid="chat-editor-mutex-confirm"
      />
    </>
  );
}
