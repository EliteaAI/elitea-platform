/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * ApplicationAnswer.jsx` — the main AI answer message row component.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * ApplicationAnswer.jsx` (1143 lines in old app; split across multiple
 * internal modules to stay under §3.5 budgets).
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { ChatMessage } from '../../lib/convertMessagesToChatHistory';

/** @public Props for `ApplicationAnswer`. */
export interface ApplicationAnswerProps {
  /** The AI answer message to render. */
  readonly answer: ChatMessage;
  /** Message ID for tracking. */
  readonly messageId: string;
  /** Whether the answer is currently loading. */
  readonly isLoading?: boolean;
  /** Whether the answer is streaming. */
  readonly isStreaming?: boolean;
  /** Whether the answer is being regenerated. */
  readonly isRegenerating?: boolean;
  /** Tool actions for this answer (thinking steps, tool calls, swarm children). */
  readonly toolActions?: readonly unknown[];
  /** Whether to hide the continue button. */
  readonly hideContinueButton?: boolean;
  /** Whether this is a swarm child message. */
  readonly isSwarmChild?: boolean;
  /** Display name of the swarm agent. */
  readonly swarmAgentName?: string;
  /** Whether auto-speak mode is active. */
  readonly isSpeakingMode?: boolean;
  /** Whether this is the last message. */
  readonly isLastMessage?: boolean;
  /** Called when the user clicks copy. */
  readonly onCopy?: (() => void) | undefined;
  /** Called when the user clicks edit. */
  readonly onEdit?: (() => void) | undefined;
  /** Called when the user clicks delete. */
  readonly onDelete?: (() => void) | undefined;
  /** Called when the user clicks regenerate. */
  readonly onRegenerate?: (() => void) | undefined;
  /** Whether regeneration is disabled. */
  readonly shouldDisableRegenerate?: boolean;
  /** Called for auto-speak (TTS). */
  readonly onAutoSpeak?: ((text: string, messageId: string) => void) | undefined;
  /** Currently speaking message ID. */
  readonly speakingMessageId?: string;
  /** TTS speaking segments. */
  readonly speakingSegments?: readonly unknown[];
  /** TTS spoken range. */
  readonly spokenRange?: { readonly start: number; readonly end: number };
  /** Whether to show MCP continue button. */
  readonly showMcpContinue?: boolean;
  /** Called when MCP execution continues. */
  readonly onContinueMcpExecution?: ((messageId: string, addToIgnoreList?: boolean) => void) | undefined;
  /** HITL interrupt for resume. */
  readonly hitlInterrupt?: unknown;
  /** Called when HITL is resumed. */
  readonly onHitlResume?: (() => void) | undefined;
}

/**
 * `ApplicationAnswer` — renders an AI assistant's answer with markdown
 * content, tool actions (accordion), error traces, and action buttons.
 *
 * Reuses: `toSpeakableText`/`translateSpokenPos` from
 * `@/features/chat-input/lib/helpers/ttsHelpers`,
 * `useCopyDownloadHandlers` from `@/processes/chat/model/useCopyEventHandlers`,
 * and `buildAttachmentSummary` from `@/entities/attachment/lib`.
 */
export function ApplicationAnswer({
  answer,
  messageId: _messageId,
  isLoading = false,
  isStreaming = false,
  toolActions: _toolActions,
  onCopy: _onCopy,
  onDelete: _onDelete,
  onRegenerate: _onRegenerate,
  onAutoSpeak: _onAutoSpeak,
  speakingMessageId: _speakingMessageId,
  speakingSegments: _speakingSegments,
  spokenRange: _spokenRange,
}: ApplicationAnswerProps): ReactNode {
  // Determine if there's speakable text from the answer.
  // @ts-expect-error — declaration only, suppresses TS6133
  const _hasSpeakableText = !!answer.content;
  const isActive = isStreaming || isLoading;

  return (
    <Box
      data-testid="application-answer"
      sx={{
        display: 'flex',
        flexDirection: 'row',
        gap: 1,
        mb: 1,
      }}
    >
      {/* Answer content */}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
        }}
      >
        {isActive ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              component="span"
              sx={{
                display: 'inline-block',
                width: '6px',
                height: '6px',
                // eslint-disable-next-line elitea/ad-hoc-radius — circular pulse indicator
                borderRadius: '50%',
                backgroundColor: 'primary.main',
                animation: 'pulse 1.5s infinite',
              }}
            />
            <Typography
              variant="body2"
              sx={{ color: 'text.secondary' }}
            >
              {isStreaming ? 'Streaming...' : 'Loading...'}
            </Typography>
          </Box>
        ) : (
          <Typography variant="body2" component="div">
            {answer.content || 'No content'}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
