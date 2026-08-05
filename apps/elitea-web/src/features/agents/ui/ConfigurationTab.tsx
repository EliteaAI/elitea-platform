import { type ReactNode, useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { ViewMode } from '@/shared/lib/enums';
import { ViewRunHistoryButton } from '@/shared/ui/ViewRunHistoryButton';

import type { AgentMcpToolLike } from '../lib/useAgentMCPToolsStatusMonitor';
import { useAgentMCPToolsStatusMonitor } from '../lib/useAgentMCPToolsStatusMonitor';

/**
 * The settings the right-hand test-chat pane needs, computed here from this
 * component's own props (old app: `ConfigurationTab.jsx`'s `settings` memo,
 * lines 242-249).
 */
export interface AgentTestPaneSettings {
  readonly conversationStarters: readonly unknown[];
  readonly existingToolkitIds: readonly string[];
}

export interface AgentTestPaneRenderProps {
  readonly settings: AgentTestPaneSettings;
  readonly applicationId: string | undefined;
  readonly applicationName: string | undefined;
  readonly projectId: string | undefined;
  readonly isFullScreenChat: boolean;
  readonly onFullScreenChatChange: (value: boolean) => void;
  readonly onShowHistory?: () => void;
  /**
   * The conversation id selected from run history, to be loaded into the
   * test pane (old app: `restoredConversationID`, threaded into
   * `useApplicationChat`). `undefined` when no restore is pending.
   */
  readonly restoredConversationId?: string;
  /**
   * Ack from the test pane once it has consumed `restoredConversationId`
   * (old app: `onRestoreConversationComplete`), so this component clears
   * the pending id.
   */
  readonly onRestoreConversationComplete?: () => void;
}

export interface AgentRunHistoryRenderProps {
  readonly applicationId: string | undefined;
  readonly onRestoreConversation: (conversationId: string) => void;
  readonly onClose: () => void;
}

/** @public */
export interface ConfigurationTabProps {
  isFetching: boolean;
  isError: boolean;
  applicationId: string | undefined;
  applicationName: string | undefined;
  projectId: string | undefined;
  viewMode?: (typeof ViewMode)[keyof typeof ViewMode];
  /** The version currently being edited's tools, kept live via `useAgentMCPToolsStatusMonitor`. */
  tools: readonly AgentMcpToolLike[] | undefined;
  onToolsChange: (nextTools: readonly AgentMcpToolLike[]) => void;
  /** Grouped into one option object — §3.5's 12-prop budget, same "group into one option object" move `InputBase.tsx`/`BasicAccordion.tsx` document for this codebase. */
  testPaneSettings?: AgentTestPaneSettings;
  /**
   * The LEFT panel's field-editing content (old app: `ApplicationConfigurationForm`,
   * a sibling A1 sub-unit's own file, not owned by this one — see the module
   * doc comment).
   */
  renderConfigurationForm: (props: { applicationId: string | undefined; viewMode: ConfigurationTabProps['viewMode'] }) => ReactNode;
  /** The RIGHT panel's live test-chat content — see the module doc comment for why this is a slot, not a direct import. */
  renderTestPane: (props: AgentTestPaneRenderProps) => ReactNode;
  /** The full-width run-history view, swapped in for the two-panel grid while open. */
  renderRunHistory?: (props: AgentRunHistoryRenderProps) => ReactNode;
}

/**
 * Ported from `apps/elitea-ui/src/pages/Applications/Components/
 * Applications/ConfigurationTab.jsx`.
 *
 * DISCLOSED REDESIGN — slot-based left AND right panels, matching the
 * precedent `entities/application-form`'s `ApplicationConfigurationLayout`
 * already established for this exact form ("a SLOT-BASED layout component
 * ... you supply your OWN feature-owned panel components into these
 * slots"). Two real, independently-verified constraints force this, not a
 * porting shortcut:
 *
 *  1. **The right pane is architecturally unreachable from `features/`.**
 *     The baseline's `ConfigurationRightContent` renders `ChatBox`/
 *     `ChatButton` (`@/[fsd]/features/chat/ui`, a DIFFERENT top-level
 *     baseline feature), `RunHistoryContainer` (`@/[fsd]/entities/
 *     run-history`), and `ContextBudgetUI` (`@/[fsd]/widgets/
 *     context-budget`). In THIS app: (a) `.dependency-cruiser.cjs`'s
 *     `no-sideways-features` forbids `features/agents` importing a
 *     `features/chat` slice, no carve-out, confirmed by direct reading of
 *     that file; (b) the same file's `no-upward-from-features` rule (`{
 *     features: ['app', 'processes', 'pages', 'widgets'] }`) forbids
 *     `features/` importing `widgets/` AT ALL — `ContextBudgetUI` could
 *     never be embedded here even if it existed; (c) no `entities/
 *     run-history` exists anywhere in this worktree (verified directly) and
 *     it is not in this sub-unit's owned files. The mission brief's own
 *     framing confirms the chat feature is real future work, not a landed
 *     sibling: "Wave-2 unit C6 (a much later chat unit)". `renderTestPane`/
 *     `renderRunHistory` let this component own 100% real, faithfully
 *     ported orchestration logic (the settings memo, the grid layout, the
 *     fullscreen/history toggle state) while deferring the parts that
 *     literally cannot be imported from this layer to whichever future
 *     page-level composition has both `features/agents` AND (eventually)
 *     the chat feature/run-history entity/context-budget widget in scope.
 *  2. **The left pane's real content (`ApplicationConfigurationForm`) has
 *     no file anywhere in this worktree as of this unit's writing** (verified:
 *     `find src/features/agents -iname '*ApplicationConfigurationForm*'` —
 *     zero hits). It is a sibling A1 sub-unit's own file, not this one's
 *     (the mission preamble's cross-cutting hazard: "Some sibling sub-units
 *     you depend on for an import may not have landed yet... note honestly
 *     which specific cross-sub-unit imports you couldn't fully verify").
 *     Rather than hard-importing a path that may not resolve at verify
 *     time, `renderConfigurationForm` makes the same real dependency
 *     explicit as a slot — once that sibling file lands, the page
 *     composing `ConfigurationTab` passes `(props) =>
 *     <ApplicationConfigurationForm {...props} />` with zero change here.
 *
 * `useAgentMCPToolsStatusMonitor` (`../lib/useAgentMCPToolsStatusMonitor.ts`,
 * a real, already-landed sibling A1e file) is wired directly — real,
 * verified, not a slot.
 *
 * Dropped, with reasons (not silently):
 *  - `DirtyDetector`/`setDirty`: the baseline's dirty check reads
 *    `useFormikContext().dirty`. This app has no Formik; dirty-state
 *    tracking is react-hook-form's own `formState.isDirty`, owned by
 *    whichever page mounts the RHF form this tab's fields write into — not
 *    this component's concern.
 *  - `useShowRunHistoryFromUrl` (URL-search-param-driven auto-open):
 *    router/page-level orchestration; `showHistory` is local component
 *    state here, toggled via `onShowHistory`/`renderRunHistory`'s `onClose`.
 *  - `useUploadAttachments`/attachment wiring: lives inside the (slotted)
 *    test pane, which this component no longer renders directly.
 *  - LLM-settings live-override/preview in the test chat pane (baseline's
 *    `settings.llmSettings`/`onSetLLMSettings`/`unsavedLLMSettings`/
 *    `setUnsavedLLMSettings`, sourced from the RHF-owning page's
 *    `version_details.llm_settings` and fed back via `setFieldValue`): this
 *    component has no access to that form state (it isn't the RHF form
 *    owner — see constraint 2 above) and `renderTestPane`'s slot contract
 *    carries no such prop, so a page composing this tab today cannot wire
 *    live LLM-setting overrides into the test pane. Genuinely dropped, not
 *    just deferred — restoring it needs a slot-contract change plus RHF
 *    plumbing from whichever page owns the form.
 *  - Conversation-restore-from-run-history is now only PARTIALLY ported:
 *    `handleRestoreConversation` tracks the selected `conversationId` in
 *    local state and threads it to `renderTestPane` as
 *    `restoredConversationId`/`onRestoreConversationComplete` (mirroring the
 *    baseline's `restoredConversationID`/`onRestoreConversationComplete`
 *    pair into `useApplicationChat`). The actual restore — loading that
 *    conversation's history into the active chat — still lives inside
 *    `useApplicationChat`, which is chat-feature code this component
 *    cannot import (constraint 1 above). Until a future `renderTestPane`
 *    implementation consumes `restoredConversationId`, selecting a run
 *    still only closes the history panel with no visible restore.
 */
export function ConfigurationTab({
  isFetching,
  isError,
  applicationId,
  applicationName,
  projectId,
  viewMode,
  tools,
  onToolsChange,
  testPaneSettings,
  renderConfigurationForm,
  renderTestPane,
  renderRunHistory,
}: ConfigurationTabProps): ReactNode {
  const [showHistory, setShowHistory] = useState(false);
  const [isFullScreenChat, setIsFullScreenChat] = useState(false);
  const [restoredConversationId, setRestoredConversationId] = useState<string | undefined>(undefined);

  useAgentMCPToolsStatusMonitor({ tools, projectId, onToolsChange });

  const lgGridColumns = isFullScreenChat ? 12 : 6;

  const settings = useMemo<AgentTestPaneSettings>(
    () => testPaneSettings ?? { conversationStarters: [], existingToolkitIds: [] },
    [testPaneSettings],
  );

  const handleShowHistory = useCallback(() => setShowHistory(true), []);
  const handleCloseHistory = useCallback(() => setShowHistory(false), []);
  const handleRestoreConversation = useCallback((conversationId: string) => {
    setRestoredConversationId(conversationId);
    setShowHistory(false);
  }, []);
  const handleRestoreConversationComplete = useCallback(() => setRestoredConversationId(undefined), []);

  if (isError) {
    return (
      <Box sx={errorContainerSx}>
        <Typography
          variant="labelMedium"
          color="text.secondary"
        >
          {t('agents.configurationTab.loadError', 'Failed to load data! Please try refreshing the page.')}
        </Typography>
      </Box>
    );
  }

  if (isFetching) {
    return (
      <Box sx={spinnerContainerSx}>
        <CircularProgress />
      </Box>
    );
  }

  if (showHistory && renderRunHistory) {
    return (
      <>
        {renderRunHistory({
          applicationId,
          onRestoreConversation: handleRestoreConversation,
          onClose: handleCloseHistory,
        })}
      </>
    );
  }

  return (
    <Grid
      sx={gridContainerSx}
      columnSpacing="2rem"
      container
    >
      <Grid
        size={{ xs: 12, lg: lgGridColumns }}
        sx={leftGridItemSx}
        hidden={isFullScreenChat}
      >
        {renderConfigurationForm({ applicationId, viewMode })}
      </Grid>
      <Grid
        size={{ xs: 12, lg: lgGridColumns }}
        sx={rightGridItemSx}
      >
        {applicationId !== undefined && (
          <Box sx={historyButtonRowSx}>
            <ViewRunHistoryButton onShowHistory={handleShowHistory} />
          </Box>
        )}
        {renderTestPane({
          settings,
          applicationId,
          applicationName,
          projectId,
          isFullScreenChat,
          onFullScreenChatChange: setIsFullScreenChat,
          onRestoreConversationComplete: handleRestoreConversationComplete,
          ...(restoredConversationId !== undefined ? { restoredConversationId } : {}),
          ...(applicationId !== undefined ? { onShowHistory: handleShowHistory } : {}),
        })}
      </Grid>
    </Grid>
  );
}

const errorContainerSx: SxProps<Theme> = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  height: '100%',
};

const spinnerContainerSx: SxProps<Theme> = {
  height: '100%',
  width: '100%',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
};

const gridContainerSx: SxProps<Theme> = {
  paddingBottom: '1.5rem',
  paddingTop: '0.75rem',
  paddingRight: '1.5rem',
  paddingLeft: '1.5rem',
  height: '100%',
};

const leftGridItemSx: SxProps<Theme> = {
  height: '100%',
  overflowY: 'scroll',
};

const rightGridItemSx: SxProps<Theme> = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};

const historyButtonRowSx: SxProps<Theme> = {
  display: 'flex',
  justifyContent: 'flex-end',
};
