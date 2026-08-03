/**
 * Split out of `ApplicationAnswer.tsx` to stay under the file-length budget
 * (§3.5) — the hover-revealed Copy/Regenerate/Delete/Read-aloud action row,
 * each button only rendering when its handler is supplied.
 */
import type { ReactNode } from 'react';

import AutorenewIcon from '@mui/icons-material/Autorenew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import VolumeUpOutlinedIcon from '@mui/icons-material/VolumeUpOutlined';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

/** @public Props for `ApplicationAnswerActions`. */
export interface ApplicationAnswerActionsProps {
  readonly hasContent: boolean;
  readonly isProcessing: boolean;
  readonly shouldDisableRegenerate: boolean;
  readonly hasSpeakableText: boolean;
  readonly isSpeaking: boolean;
  readonly onAutoSpeak?: (() => void) | undefined;
  readonly onCopy?: (() => void) | undefined;
  readonly onRegenerate?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
}

export function ApplicationAnswerActions({
  hasContent,
  isProcessing,
  shouldDisableRegenerate,
  hasSpeakableText,
  isSpeaking,
  onAutoSpeak,
  onCopy,
  onRegenerate,
  onDelete,
}: ApplicationAnswerActionsProps): ReactNode {
  return (
    <Box className="actionButtons" sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, mt: 1, visibility: 'hidden' }}>
      {onAutoSpeak && hasSpeakableText && (
        <Tooltip title="Read out" placement="top">
          <span>
            <IconButton
              size="small"
              color="tertiary"
              disabled={isProcessing || isSpeaking}
              onClick={onAutoSpeak}
              aria-label="Read out"
            >
              <VolumeUpOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
      {onCopy && hasContent && (
        <Tooltip title="Copy to clipboard" placement="top">
          <IconButton
            size="small"
            color="tertiary"
            disabled={isProcessing}
            onClick={onCopy}
            aria-label="Copy to clipboard"
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {onRegenerate && (
        <Tooltip title="Regenerate" placement="top">
          <span>
            <IconButton
              size="small"
              color="tertiary"
              disabled={shouldDisableRegenerate}
              onClick={onRegenerate}
              aria-label="Regenerate"
            >
              <AutorenewIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
      {onDelete && (
        <Tooltip title="Delete" placement="top">
          <IconButton
            size="small"
            color="tertiary"
            onClick={onDelete}
            aria-label="Delete"
          >
            <DeleteOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
