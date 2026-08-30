import type { Component, ErrorInfo, ReactNode } from 'react';
import { PureComponent } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ConfigurationTabProps } from '@/features/pipelines';
import { t } from '@/shared/i18n';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';

import { PipelineTestChat, type PipelineTestChatProps } from '../ui/PipelineTestChat';

/** What `buildPipelineConfigurationTabSlots` needs to build the chat slot — grouped into one object so the factory keeps two parameters. */
export interface PipelineChatSlotContext {
  readonly identity: PipelineTestChatProps['identity'];
  readonly user: PipelineTestChatProps['user'];
}

/**
 * `ConfigurationTab`'s two REQUIRED slots (`renderConfigurationForm`/
 * `renderChat`), built for `EditPipeline.tsx` — one of them still a
 * disclosed stand-in, the other now real.
 *
 * **ONE gap is left here, and the other two are CLOSED — the old text
 * claiming all three was stale and is corrected, not preserved:**
 *  - `renderConfigurationForm` is no longer a pure stand-in: it now carries
 *    the model picker the page supplies (`buildPipelineConfigurationTabSlots`
 *    below), which is the one panel of that form this app can build. The
 *    REST of it still needs the six `features/agents`-owned configuration
 *    panels (`ApplicationTools`/`WelcomeMessageInput`/etc.) —
 *    NOT exported from `features/agents/index.ts` (verified: `grep -n
 *    "^export" src/features/agents/index.ts`, no such names), and
 *    `no-deep-slice-import` (`.dependency-cruiser.cjs`) mechanically forbids
 *    `pages/` from reaching a slice's un-exported internals regardless.
 *    This one is REAL and stays.
 *  - `renderChat` — CLOSED. The old reason ("needs `features/chat`'s
 *    `ChatBox` — that slice does not exist") named the wrong slice. The chat
 *    composition root is `widgets/chat-box`, which exports `ChatBox` and
 *    `ChatBoxHandle`; `ChatBoxHandle` is a structural SUPERSET of the
 *    `ChatBoxSlotHandle` (`stopAll`/`onClear`) `ChatPanel.tsx` declares as
 *    what the slot owes. `features/pipelines` genuinely may not import a
 *    widget (`no-upward-from-features`) — which is the whole reason this is
 *    a slot — but this module is in `pages/`, and `pages/` may. The slot now
 *    renders `../ui/PipelineTestChat.tsx`; read that file for the run-event
 *    wire it also carries.
 *  - `adapter` — CLOSED, see `./usePipelineChatAdapter.ts`. The four
 *    operations were never missing from the app, only from the GENERATED
 *    client: `entities/conversation`'s `conversationApi` has been carrying
 *    all of them since unit C1, and `ui/ChatWithPipelineButton.tsx` in this
 *    very directory already calls two of them. The placeholder that resolved
 *    every method to `{ error: 'not_available' }` is deleted.
 */

const gapContainerSx: SxProps<Theme> = { padding: '1.5rem', height: '100%', boxSizing: 'border-box' };

/**
 * `ConfigurationTab`'s required `slots.renderConfigurationForm`.
 *
 * `modelSettings` is the one panel of that form this app can actually build —
 * `widgets/agent-model-settings`, which the page supplies — and it is
 * rendered ABOVE the gap notice rather than instead of it: the other panels
 * (tools, welcome message, editor notes, information) really are still
 * missing, and hiding that once one of them exists would be the "disclosed
 * gap that quietly goes stale" this codebase has been bitten by before.
 * See this module's own doc comment for why the rest can't be reached here.
 */
function renderPipelineConfigurationFormGap(modelSettings: ReactNode): ReactNode {
  return (
    <Box
      data-testid="edit-pipeline-configuration-form-gap"
      sx={gapContainerSx}
    >
      {modelSettings}
      <NoResultsMessage
        title={t('pages.pipelines.editPipeline.configurationFormGap.title', 'Configuration form is not available yet.')}
        description={t(
          'pages.pipelines.editPipeline.configurationFormGap.description',
          'The agent-domain form panels this section composes have not landed in this app yet.',
        )}
      />
    </Box>
  );
}

/**
 * `ConfigurationTab`'s required `slots` prop.
 *
 * A factory rather than the module-scope constant it used to be, because
 * both slots now carry page-owned content — the model picker (whose value
 * and `onChange` belong to `EditPipeline`'s own state) and the test chat
 * (which needs the pipeline's identity and the signed-in user). The caller
 * memoises the result on those inputs — `GeneralFormPanel`/`ChatPanel` call
 * their render props straight through and hold them in no dependency array,
 * so a fresh object costs nothing but is still worth not rebuilding every
 * keystroke.
 */
export function buildPipelineConfigurationTabSlots(
  modelSettings: ReactNode,
  chat: PipelineChatSlotContext,
): ConfigurationTabProps['slots'] {
  return {
    renderConfigurationForm: () => renderPipelineConfigurationFormGap(modelSettings),
    renderChat: ({ settings, disableChat, ref }) => (
      <PipelineTestChat
        settings={settings}
        disableChat={disableChat}
        slotRef={ref}
        identity={chat.identity}
        user={chat.user}
      />
    ),
  };
}

interface PipelineConfigurationTabBoundaryProps {
  readonly children: ReactNode;
}
interface PipelineConfigurationTabBoundaryState {
  readonly hasError: boolean;
}

const boundaryFallbackSx: SxProps<Theme> = { padding: '1.5rem' };

/**
 * Contains a crash inside the editor subtree so it cannot take the whole
 * page (name, Save/Cancel bar, not-found handling) down with it — same
 * `PureComponent`/`getDerivedStateFromError` shape
 * `features/pipelines/ui/EditorPanel.tsx`'s own `FlowEditorErrorBoundary`
 * establishes for this "no `react-error-boundary` dependency" codebase.
 *
 * **CORRECTION — the reason this boundary used to give was FALSE, and is
 * deleted rather than reworded.** It said: "verified nobody provides a
 * `SocketClientContext.Provider` anywhere in this worktree's real (non-test)
 * render tree — zero hits". `src/app/providers/AppProviders.tsx` mounts one
 * around every page (`<SocketClientContext.Provider value={socketClient}>`),
 * and has for as long as this app has booted; the grep that "verified" the
 * claim is the kind that reads absence as proof. `useSocketClient()`
 * therefore does NOT throw here in production, and the fallback below is not
 * the expected steady state of this page — it is an error path.
 *
 * The boundary is kept anyway, for what it actually does: the flow editor is
 * the largest render subtree in the app (`@xyflow/react` plus every node
 * card), so a throw anywhere in it would otherwise unmount the page and lose
 * the user's unsaved graph along with the Save button they would use to keep
 * it. Its fallback copy is worded as a failure, not as a disclosed gap.
 */
export class PipelineConfigurationTabBoundary
  extends PureComponent<PipelineConfigurationTabBoundaryProps, PipelineConfigurationTabBoundaryState>
  implements Component
{
  override state: PipelineConfigurationTabBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PipelineConfigurationTabBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Intentionally silent beyond the fallback UI below — no error-reporting sink exists in this app yet (same as `FlowEditorErrorBoundary`).
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Box
          data-testid="edit-pipeline-configuration-tab-error"
          sx={boundaryFallbackSx}
        >
          <NoResultsMessage
            title={t('pages.pipelines.editPipeline.configurationTabError.title', 'The pipeline editor could not be displayed.')}
            description={t(
              'pages.pipelines.editPipeline.configurationTabError.description',
              'Something went wrong while rendering the editor. Reload the page to try again.',
            )}
          />
        </Box>
      );
    }
    return this.props.children;
  }
}
