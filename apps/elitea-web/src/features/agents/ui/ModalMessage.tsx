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
 * `useToast()`... this takes an `onCopied?` callback instead"). Uses
 * `shared/lib/clipboard`'s `handleCopy` (unit S3) instead of a raw
 * `navigator.clipboard.writeText` call, matching every other copy call site
 * in this app.
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
}

export function ModalMessage({ title, isUserMessage = false, message, renderInMarkdown = true, onCopied }: ModalMessageProps): ReactNode {
  const onCopy = useCallback(() => {
    void handleCopy(message).then(() => onCopied?.());
  }, [message, onCopied]);

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
