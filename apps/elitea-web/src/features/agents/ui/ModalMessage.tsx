import type { ReactNode } from 'react';
import { useCallback } from 'react';

import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { handleCopy } from '@/shared/lib/clipboard';
import { t } from '@/shared/i18n';
import { Markdown } from '@/shared/ui/Markdown';
import { EliteaAssistantIcon } from '@/shared/ui/icons/elitea-assistant-icon';
import { HumanIcon } from '@/shared/ui/icons/human-icon';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent/ui/agent-details/
 * configurations/modal/ModalMessage.jsx`.
 *
 * DISCLOSED REDESIGN — copy feedback via callback, not `useToast()`
 * directly: `features/` code copying this codebase's own established DI
 * convention for the same situation (`shared/ui/CopyToClipboardButton.tsx`'s
 * own "DEPENDENCY-INJECTION DEVIATION" doc comment: "the baseline calls
 * `useToast()`... this takes an `onCopied?` callback instead").
 *
 * **Success/failure signal, restored:** the baseline's own `onCopy`
 * (`ModalMessage.jsx:18-25`) wraps a direct `navigator.clipboard.writeText`
 * call in try/catch and gets a REAL success-or-failure result from it —
 * unlike `shared/lib/clipboard`'s `handleCopy` (unit S3), which
 * deliberately never rejects (byte-for-byte parity with the OLD APP's
 * SEPARATE, widely-shared `utils.jsx` `handleCopy` helper — a different
 * function this component's baseline never actually called). Routing this
 * component's `onCopy` through that swallow-everything helper would make
 * `onCopied` fire unconditionally, with no way to ever detect a real
 * failure (confirmed: its own module doc comment documents the final
 * fallback retry as "fire-and-forget... becomes an unhandled promise
 * rejection rather than surfacing from `handleCopy` itself"). This calls
 * `navigator.clipboard.writeText` directly when the Clipboard API is
 * present — genuinely observable success/failure, exactly like the baseline
 * — and only falls back to the shared `handleCopy` (optimistic success, no
 * failure signal available) when it is not, which the baseline never
 * exercised either.
 *
 * Icon substitutions (no `shared/ui/icons` port of the baseline's exact
 * `components/Icons/{CopyIcon,CloseIcon,UserIcon,EliteAIcon}` exists —
 * verified: none of those four names are among the 116 SVGs unit S2
 * ported): `CopyIcon`/`CloseIcon` fall back to `@mui/icons-material`, the
 * SAME interim-fallback precedent `shared/ui/BaseModal.tsx` already
 * established for its own close button (its own doc comment: "not one of
 * the 39 custom SVGs S2 is porting... resolves, and fall back rather than
 * block where it does not"). `UserIcon`/`EliteAIcon` map to this app's
 * closest real ported equivalents, `HumanIcon`/`EliteaAssistantIcon`
 * (`shared/ui/icons/human-icon.tsx` / `elitea-assistant-icon.tsx`).
 */
export interface ModalMessageProps {
  readonly title: string;
  readonly isUserMessage?: boolean;
  readonly message: string;
  readonly renderInMarkdown?: boolean;
  readonly onCopied?: () => void;
  /** Fires when the clipboard write genuinely failed — the callback equivalent of the baseline's `toastError('Failed to copy the content!')`. */
  readonly onCopyFailed?: () => void;
}

export function ModalMessage({ title, isUserMessage = false, message, renderInMarkdown = true, onCopied, onCopyFailed }: ModalMessageProps): ReactNode {
  const onCopy = useCallback(() => {
    if (typeof navigator.clipboard?.writeText === 'function') {
      void navigator.clipboard.writeText(message).then(() => onCopied?.(), () => onCopyFailed?.());
      return;
    }
    void handleCopy(message).then(() => onCopied?.());
  }, [message, onCopied, onCopyFailed]);

  return (
    <Box sx={messageContainerSx}>
      <Box sx={messageHeaderSx}>
        {isUserMessage ? (
          <Box sx={userIconContainerSx}>
            <HumanIcon />
          </Box>
        ) : (
          <EliteaAssistantIcon />
        )}
        <Typography
          variant="bodyMedium"
          color="text.secondary"
          sx={messageTitleSx}
        >
          {title}
        </Typography>
      </Box>
      <Box sx={messageContentSx}>
        <Box
          className="actionButtons"
          sx={actionButtonsContainerSx}
        >
          <Tooltip
            title={t('features.agents.modalMessage.copyTooltip', 'Copy to clipboard')}
            placement="top"
          >
            <IconButton
              color="tertiary"
              onClick={onCopy}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <Typography
          variant="bodyMedium"
          color="text.secondary"
          sx={renderInMarkdown ? undefined : preserveWhitespaceSx}
        >
          {renderInMarkdown ? <Markdown>{message}</Markdown> : message}
        </Typography>
      </Box>
    </Box>
  );
}

const messageContainerSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  width: '100%',
};

const messageHeaderSx: SxProps<Theme> = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'center',
  position: 'relative',
};

const userIconContainerSx: SxProps<Theme> = (theme: Theme) => ({
  width: '1.5rem',
  height: '1.5rem',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  // `radiusPill` (9999px) on an equal-width/height box renders as a circle — the token-driven equivalent of the baseline's `borderRadius: '50%'` (R-T10 bans the ad-hoc percentage form too).
  borderRadius: theme.vars.shape.radiusPill,
  background: theme.vars.palette.background.aiParticipantIcon,
  color: theme.vars.palette.icon.fill.inactive,
});

const messageTitleSx: SxProps<Theme> = {
  textTransform: 'capitalize',
};

const messageContentSx: SxProps<Theme> = (theme: Theme) => ({
  padding: '0.75rem 1rem',
  borderRadius: theme.vars.shape.radiusMd,
  position: 'relative',
  background: theme.vars.palette.background.aiAnswerBkg,
  '&:hover .actionButtons': {
    visibility: 'visible',
  },
});

const actionButtonsContainerSx: SxProps<Theme> = {
  display: 'flex',
  justifyContent: 'flex-end',
  visibility: 'hidden',
};

const preserveWhitespaceSx: SxProps<Theme> = {
  whiteSpaceCollapse: 'preserve',
};
