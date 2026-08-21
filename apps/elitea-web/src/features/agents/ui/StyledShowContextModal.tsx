import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback } from 'react';

import CircularProgress from '@mui/material/CircularProgress';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { handleCopy } from '@/shared/lib/clipboard';
import { t } from '@/shared/i18n';
import { Markdown } from '@/shared/ui/Markdown';

import { parseYamlToMermaid } from '../lib/helpers/parseYamlToMermaid.helpers';

import { ModalMessage } from './ModalMessage';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent/ui/agent-details/
 * configurations/modal/StyledShowContextModal.jsx`.
 *
 * Icon substitutions — same `@mui/icons-material` fallback precedent as
 * `ModalMessage.tsx` and `shared/ui/BaseModal.tsx` (no `CopyIcon`/`CloseIcon`
 * port in `shared/ui/icons`).
 *
 * `onCopy`'s success/failure signal — same restoration, same reasoning, as
 * sibling `ModalMessage.tsx`'s own doc comment: the baseline
 * (`StyledShowContextModal.jsx:42-50`) wraps a direct
 * `navigator.clipboard.writeText` call in try/catch for a REAL
 * success/failure result (`toastInfo`/`toastError`); `shared/lib/clipboard`'s
 * `handleCopy` deliberately never rejects, so this calls the Clipboard API
 * directly (falling back to `handleCopy` only when it's absent) instead of
 * routing every copy through the swallow-everything helper.
 *
 * `renderContextAsMermaid` real, documented gap: `parseYamlToMermaid`
 * (`../lib/helpers/parseYamlToMermaid.helpers.ts`, this sub-unit's own
 * sibling A1b/A1e-adjacent port — landed in this worktree, reused here
 * intra-slice) produces a real Mermaid `graph TD` DEFINITION STRING, byte-
 * for-byte faithful to the baseline. What the baseline additionally had —
 * `components/MermaidDiagramOutput/DiagramOutput` — actually RENDERS that
 * string as an SVG diagram (the `mermaid` npm package). No such renderer
 * exists anywhere in this app (`grep -n '"mermaid"' package.json` — zero
 * hits; `find shared/ui -iname '*mermaid*'` — zero hits): the diagram
 * definition is real and computed correctly, but there is nothing in this
 * worktree that turns it into a picture yet. Rather than inventing a
 * mermaid-rendering integration (a `shared/ui` concern, out of this
 * sub-unit's ownership fence), the raw diagram-definition text is shown
 * inside a `<pre>`-equivalent monospace block — an honest "here is the
 * diagram source, unrendered" state, not a silent no-op.
 */
interface StyledShowContextModalMessage {
  readonly id: string | number;
  readonly role: string;
  readonly content: string;
}

export interface StyledShowContextModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly context?: string;
  readonly messages?: readonly StyledShowContextModalMessage[];
  readonly contextLabel?: string;
  readonly renderContextAsMermaid?: boolean;
  readonly renderInMarkdown?: boolean;
  readonly isLoading?: boolean;
  /** `apps/elitea-ui/src/common/constants.js` `ROLES.User` — injected rather than imported, `common/constants.js` is not this sub-unit's owned surface. */
  readonly userRole?: string;
  /** Fires once the "copy to clipboard" action genuinely succeeds — the callback equivalent of the baseline's `toastInfo('The content has been copied to the clipboard')`. */
  readonly onCopied?: () => void;
  /** Fires once the "copy to clipboard" action genuinely fails — the callback equivalent of the baseline's `toastError('Failed to copy the content!')`. */
  readonly onCopyFailed?: () => void;
}

interface ModalHeaderProps {
  readonly contextLabel: string;
  readonly showCopyAction: boolean;
  readonly onCopy: () => void;
  readonly onClose: () => void;
}

/** Split out of `StyledShowContextModal` purely to keep its own cyclomatic complexity under the oxlint budget (12) — same reason `shared/ui/BaseModal.tsx` splits `ModalHeader`/`ModalActions`. */
function ModalHeader({ contextLabel, showCopyAction, onCopy, onClose }: ModalHeaderProps): ReactNode {
  return (
    <DialogTitle
      variant="headingMedium"
      color="text.secondary"
      sx={dialogTitleSx}
    >
      <Box sx={titleContainerSx}>
        {contextLabel}
        <Box sx={buttonsContainerSx}>
          {showCopyAction && (
            <Tooltip
              title={t('features.agents.styledShowContextModal.copyTooltip', 'Copy to clipboard')}
              placement="top"
            >
              <IconButton
                color="tertiary"
                onClick={onCopy}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <IconButton
            color="tertiary"
            aria-label={t('common.closeAriaLabel', 'Close')}
            onClick={onClose}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
    </DialogTitle>
  );
}

interface ModalBodyProps {
  readonly context: string;
  readonly messages: readonly StyledShowContextModalMessage[];
  readonly renderContextAsMermaid: boolean;
  readonly mermaidDefinition: string;
  readonly renderInMarkdown: boolean;
  readonly isLoading: boolean;
  readonly userRole: string;
}

/** Same complexity-budget split as `ModalHeader` above. */
function ModalBody({ context, messages, renderContextAsMermaid, mermaidDefinition, renderInMarkdown, isLoading, userRole }: ModalBodyProps): ReactNode {
  return (
    <DialogContent sx={dialogContentSx}>
      {isLoading && <CircularProgress size={20} />}
      {renderContextAsMermaid && (
        <Typography
          component="pre"
          variant="bodySmall"
          sx={mermaidSourceSx}
        >
          {mermaidDefinition}
        </Typography>
      )}
      {!renderContextAsMermaid && context && (
        <Typography
          variant="bodyMedium"
          color="text.secondary"
          sx={renderInMarkdown ? undefined : preserveWhitespaceSx}
        >
          {renderInMarkdown ? <Markdown>{context}</Markdown> : context}
        </Typography>
      )}
      {messages.map(({ id, role, content }) => (
        <ModalMessage
          key={id}
          title={role}
          message={content}
          isUserMessage={role === userRole}
        />
      ))}
    </DialogContent>
  );
}

export function StyledShowContextModal({
  open,
  onClose,
  context = '',
  messages = [],
  contextLabel = t('features.agents.styledShowContextModal.defaultLabel', 'Context'),
  renderContextAsMermaid = false,
  renderInMarkdown = true,
  isLoading = false,
  userRole = 'user',
  onCopied,
  onCopyFailed,
}: StyledShowContextModalProps): ReactNode {
  const mermaidDefinition = renderContextAsMermaid ? parseYamlToMermaid(context) : '';

  const onCopy = useCallback(() => {
    if (typeof navigator.clipboard?.writeText === 'function') {
      void navigator.clipboard.writeText(context).then(() => onCopied?.(), () => onCopyFailed?.());
      return;
    }
    void handleCopy(context).then(() => onCopied?.());
  }, [context, onCopied, onCopyFailed]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  return (
    <Dialog
      open={open}
      onKeyDown={handleKeyDown}
      slotProps={{ paper: { sx: dialogPaperSx } }}
    >
      <ModalHeader
        contextLabel={contextLabel}
        showCopyAction={!renderContextAsMermaid && context !== ''}
        onCopy={onCopy}
        onClose={onClose}
      />
      <ModalBody
        context={context}
        messages={messages}
        renderContextAsMermaid={renderContextAsMermaid}
        mermaidDefinition={mermaidDefinition}
        renderInMarkdown={renderInMarkdown}
        isLoading={isLoading}
        userRole={userRole}
      />
    </Dialog>
  );
}

const dialogPaperSx: SxProps<Theme> = (theme: Theme) => ({
  background: theme.vars.palette.background.tabPanel,
  borderRadius: theme.vars.shape.radiusLg,
  border: `1px solid ${theme.vars.palette.border.lines}`,
  boxShadow: theme.vars.palette.boxShadow.default,
  marginTop: 0,
  maxWidth: '90vw',
  height: 'calc(100vh - 10rem)',
});

const dialogTitleSx: SxProps<Theme> = {
  height: '3.75rem',
  padding: '1rem 2rem',
};

const titleContainerSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const buttonsContainerSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: '0.5rem' };

const dialogContentSx: SxProps<Theme> = (theme: Theme) => ({
  // R-T5 bans `!important` (elitea/no-important-sx) — dropped from the baseline's
  // `padding: '1rem 2rem !important'`; MUI's `DialogContent` default padding may
  // win this specificity fight where the baseline's `!important` guaranteed it.
  padding: '1rem 2rem',
  width: '80vw',
  maxWidth: '90vw',
  height: 'calc(100vh - 13.75rem)',
  borderTop: `1px solid ${theme.vars.palette.border.lines}`,
  background: theme.vars.palette.background.showContextDialog,
  overflowY: 'scroll',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
});

const mermaidSourceSx: SxProps<Theme> = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'monospace',
};

const preserveWhitespaceSx: SxProps<Theme> = {
  whiteSpaceCollapse: 'preserve',
};
