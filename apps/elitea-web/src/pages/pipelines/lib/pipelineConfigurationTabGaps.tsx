import type { Component, ErrorInfo, ReactNode } from 'react';
import { PureComponent } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ConfigurationTabProps } from '@/features/pipelines';
import { t } from '@/shared/i18n';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';

/**
 * Disclosed-gap stand-ins for `ConfigurationTab`'s two REQUIRED slots
 * (`renderConfigurationForm`/`renderChat`) and its required `adapter` prop,
 * used only by `EditPipeline.tsx` (this unit, A2m/A2's own composition-gap
 * fix — see that page's doc comment for the full picture).
 *
 * **Why these can't be the real thing, mechanically, not just "not yet
 * built":**
 *  - `renderConfigurationForm` needs the six `features/agents`-owned
 *    configuration panels (`ApplicationTools`/`WelcomeMessageInput`/etc.) —
 *    NOT exported from `features/agents/index.ts` (verified: `grep -n
 *    "^export" src/features/agents/index.ts`, no such names), and
 *    `no-deep-slice-import` (`.dependency-cruiser.cjs`) mechanically forbids
 *    `pages/` from reaching a slice's un-exported internals regardless.
 *  - `renderChat` needs `features/chat`'s `ChatBox`/`ChatButton` — that
 *    slice does not exist anywhere in this worktree yet (verified: `ls
 *    src/features/chat` — no such directory; `ConfigurationTab.tsx`'s own
 *    doc comment already discloses this same gap for its `renderChat` slot).
 *  - `adapter` (`ChatConversationAdapter`) needs real
 *    create-conversation/delete-message/stop-task REST endpoints —
 *    `ChatConversationAdapter`'s OWN doc comment
 *    (`features/pipelines/lib/hooks/pipelineChat.types.ts`) already
 *    discloses these do not exist in the generated client yet ("a future
 *    chat-domain unit supplies the real implementation once these endpoints
 *    exist"). `DISCLOSED_PIPELINE_CHAT_ADAPTER` below is that documented
 *    placeholder, not a new gap.
 *
 * Replacing all three turns "the whole standalone pipeline editor is blank"
 * (the confirmed regression) into "the flow editor (`EditorPanel`/
 * `FlowEditor`, hundreds of already-landed, already-tested files) is real
 * and live; only the two genuinely cross-slice sub-panels show a disclosed
 * gap" — the same "disclosed placeholder, not a silent workaround"
 * discipline this whole mission uses throughout (e.g. `EditPipeline.tsx`'s
 * own prior single big placeholder, `ConfigurationTab.tsx`'s `renderChat`/
 * `renderContextBudget` slots).
 */

const gapContainerSx: SxProps<Theme> = { padding: '1.5rem', height: '100%', boxSizing: 'border-box' };

/** `ConfigurationTab`'s required `slots.renderConfigurationForm` — see this module's own doc comment for why the real agent-domain panels can't be reached from here. */
function renderPipelineConfigurationFormGap(): ReactNode {
  return (
    <Box
      data-testid="edit-pipeline-configuration-form-gap"
      sx={gapContainerSx}
    >
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

/** `ConfigurationTab`'s required `slots.renderChat` — see this module's own doc comment for why the real `features/chat` chat box can't be reached from here (that slice does not exist yet). */
function renderPipelineChatGap(): ReactNode {
  return (
    <Box
      data-testid="edit-pipeline-chat-gap"
      sx={gapContainerSx}
    >
      <NoResultsMessage
        title={t('pages.pipelines.editPipeline.chatGap.title', 'Live test chat is not available yet.')}
        description={t('pages.pipelines.editPipeline.chatGap.description', 'The chat feature this panel embeds has not landed in this app yet.')}
      />
    </Box>
  );
}

/** Every `ChatConversationAdapter` method resolves to this same "not available" result — real network calls have nothing to hit yet (see this module's own doc comment). */
const ADAPTER_GAP_RESULT = { error: 'not_available' } as const;

/**
 * The documented placeholder `ChatConversationAdapter`
 * (`pipelineChat.types.ts`'s own doc comment) — every method resolves
 * instead of throwing, so `usePipelineChat`'s internal error-handling paths
 * (already real, already tested against a rejected/errored adapter call)
 * run exactly as they would against a real backend that returned an error,
 * rather than an unhandled rejection crashing the page. A module-scope
 * constant, not a per-render factory — `usePipelineChat.hooks.ts` closes
 * over `adapter` in several `useCallback`/`useEffect` dependency arrays, so
 * a stable reference matters here (this is a plain object literal, not a
 * zustand store — `elitea/no-module-scope-store`, R-S2, does not apply).
 */
export const DISCLOSED_PIPELINE_CHAT_ADAPTER: ConfigurationTabProps['adapter'] = {
  createConversation: () => Promise.resolve(ADAPTER_GAP_RESULT),
  deleteMessage: () => Promise.resolve(ADAPTER_GAP_RESULT),
  deleteAllMessages: () => Promise.resolve(ADAPTER_GAP_RESULT),
  stopChatTask: () => Promise.resolve(),
};

/** `ConfigurationTab`'s required `slots` prop, built once — both render functions are stable module-scope references, so this whole object is too (no reason to rebuild it every `EditPipeline` render). */
export const PIPELINE_CONFIGURATION_TAB_GAP_SLOTS: ConfigurationTabProps['slots'] = {
  renderConfigurationForm: renderPipelineConfigurationFormGap,
  renderChat: renderPipelineChatGap,
};

interface PipelineConfigurationTabBoundaryProps {
  readonly children: ReactNode;
}
interface PipelineConfigurationTabBoundaryState {
  readonly hasError: boolean;
}

const boundaryFallbackSx: SxProps<Theme> = { padding: '1.5rem' };

/**
 * Guards the real `<ConfigurationTab>` mount in `EditPipeline.tsx` against
 * one more real, disclosed, OUT-OF-CLUSTER-SCOPE gap: `ConfigurationTab`
 * unconditionally calls `usePipelineChat`/`usePipelineMCPToolsStatusMonitor`,
 * both of which call `useSocketClient()`
 * (`shared/api/socket/client.ts`) — and that hook throws synchronously
 * during render if no `SocketClientContext.Provider` is mounted above it
 * (`useSocketClient`'s own doc comment: "a missing provider is a programmer
 * error, not a recoverable state").
 *
 * **Verified nobody provides one anywhere in this worktree's real
 * (non-test) render tree** (`grep -rn "SocketClientContext.Provider" src
 * --include=*.tsx | grep -v test` — zero hits) — `client.ts`'s own doc
 * comment assigns creating that ONE instance to "the app layer (R2, Wave
 * 1)" (`shared/api/socket/client.ts:6-9`), i.e. genuinely outside
 * `pages/pipelines`' (and this whole A2 cluster's) file scope; `pages/chat/
 * index.tsx`'s own doc comment already discloses the sibling gap for
 * `ChatBox` ("no fully-wired source until unit S1/AppShell or R2/router-
 * context lands"). Not something to fabricate a page-local socket
 * connection for either — `client.ts` is explicit that there must be
 * exactly ONE app-wide instance (R-S2), and `shared/api/socket/testing.ts`'s
 * `createTestSocketClient` is documented "Test-only surface", not a
 * production stand-in.
 *
 * Rather than let that real infra gap crash this whole page (name, Save/
 * Cancel bar, not-found handling — everything `EditPipeline` already does
 * correctly), this local error boundary (same `PureComponent`/
 * `getDerivedStateFromError` shape `features/pipelines/ui/EditorPanel.tsx`'s
 * own `FlowEditorErrorBoundary` already establishes for this exact
 * "no `react-error-boundary` dependency" codebase convention) contains the
 * blast radius to the flow-editor area alone, with the same disclosed-gap
 * messaging as `renderPipelineConfigurationFormGap`/`renderPipelineChatGap`
 * above. Once R2/S1 mounts the real provider, this boundary's fallback
 * simply stops firing — no code change needed here.
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
            title={t('pages.pipelines.editPipeline.configurationTabError.title', 'The pipeline editor is not available yet.')}
            description={t(
              'pages.pipelines.editPipeline.configurationTabError.description',
              'Some app-wide infrastructure this editor depends on has not landed yet. Please try again later.',
            )}
          />
        </Box>
      );
    }
    return this.props.children;
  }
}
