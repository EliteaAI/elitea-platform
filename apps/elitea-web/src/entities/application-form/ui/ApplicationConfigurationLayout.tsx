import type { ReactNode } from 'react';
import { useMemo } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

/**
 * `ApplicationConfigurationLayout` — ported from
 * `apps/elitea-ui/src/pages/Applications/Components/Applications/
 * PipelineConfigurationForm.jsx` (Wave-2 promotion pass, Part 1 file 7 of
 * 7). Renamed from "Pipeline..." to "Application..." because, once
 * stripped to its actual generic content, this component is not
 * pipeline-specific at all — it is the shared vertical-stack layout
 * (spacing + the `isChatView`/`viewMode` conditionals) used to arrange an
 * application/pipeline's editing panels, exactly the "Pipeline literally IS
 * an Application row with `agent_type: 'pipeline'`" relationship
 * `entities/pipeline/model/types.ts` already documents.
 *
 * DISCLOSED REDESIGN: the baseline directly imports and renders six
 * `features/agent`-owned panels — `AgentInput.WelcomeMessageInput`,
 * `ApplicationTools`, `ApplicationAdvanceSettings`, `ApplicationEditorNotes`,
 * `ApplicationEditForm`, `ApplicationInformation` (plus
 * `components/ConversationStarters`) — none of which are part of this
 * promotion's file list, and none of which `entities/` may import even if
 * they were (`no-upward-from-entities`: `entities/` cannot import
 * `features/`). This component keeps the ORIGINAL layout/visibility
 * decisions (spacing per panel, which panels are hidden outside
 * `isChatView`, which panels are disabled outside owner view) but takes
 * every panel as an injected `ReactNode` slot instead of importing a
 * concrete component. A1 (agent) and A2 (pipeline) each pass their own
 * panels into the same slots — this is the "peers, not one owning the
 * other" relationship the promotion brief itself describes for Application
 * vs. Pipeline.
 */
export interface ApplicationConfigurationLayoutProps {
  /** The baseline's `ViewMode` values are `'Owner'`/`'Public'`; typed as `string` (not a union) since `entities/` may not import the `ViewMode` enum's owning module. */
  readonly viewMode: string;
  readonly isChatView?: boolean;
  readonly containerSx?: SxProps<Theme>;
  /** The `ApplicationEditForm` slot — hidden entirely in chat view, same as the baseline. */
  readonly editForm?: ReactNode;
  /** The `ApplicationTools` slot — always rendered. */
  readonly tools: ReactNode;
  /** The `AgentInput.WelcomeMessageInput` slot — rendered only for the owner (not disabled). */
  readonly welcomeMessage?: ReactNode;
  /** The `ConversationStarters` slot — rendered only for the owner (not disabled). */
  readonly conversationStarters?: ReactNode;
  /** The `ApplicationAdvanceSettings` slot — always rendered, caller controls its own disabled state. */
  readonly advanceSettings?: ReactNode;
  /** The `ApplicationEditorNotes` slot — always rendered, caller controls its own disabled state. */
  readonly editorNotes?: ReactNode;
  /** The `ApplicationInformation` slot — always rendered. */
  readonly information?: ReactNode;
}

export function ApplicationConfigurationLayout({
  viewMode,
  isChatView = false,
  containerSx,
  editForm,
  tools,
  welcomeMessage,
  conversationStarters,
  advanceSettings,
  editorNotes,
  information,
}: ApplicationConfigurationLayoutProps): ReactNode {
  const isOwner = viewMode === 'Owner';
  const styles = useMemo(() => layoutStyles(isChatView), [isChatView]);

  return (
    <Box sx={containerSx}>
      {!isChatView && editForm}
      <Box sx={styles.tools}>{tools}</Box>
      {isOwner && (
        <>
          {welcomeMessage}
          <Box sx={styles.conversationStarters}>{conversationStarters}</Box>
        </>
      )}
      <Box sx={styles.advanceSettings}>{advanceSettings}</Box>
      <Box sx={styles.editorNotes}>{editorNotes}</Box>
      <Box sx={styles.information}>{information}</Box>
    </Box>
  );
}

function layoutStyles(isChatView: boolean): Record<'tools' | 'conversationStarters' | 'advanceSettings' | 'editorNotes' | 'information', SxProps<Theme>> {
  return {
    tools: { marginTop: !isChatView ? '1rem' : 0 },
    conversationStarters: { marginTop: '1rem' },
    advanceSettings: { marginTop: '1rem' },
    editorNotes: { marginTop: '1rem' },
    information: { marginTop: '1rem' },
  };
}
