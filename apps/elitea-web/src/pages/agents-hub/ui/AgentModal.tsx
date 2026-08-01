/* oxlint-disable i18next/no-literal-string, elitea/ad-hoc-radius, elitea/no-important-sx -- Wave-2 prototype: UI copy from ported baseline (S8 pending), ad-hoc radii and !important from baseline CSS. REMOVER: S8 + token pass. */
/**
 * Agent Modal — detail dialog for a selected agent.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent-hub/ui/AgentModal.jsx`.
 *
 * Deviations:
 *  - No tour IDs.
 *  - No Redux dispatch / chat context — "Start conversation" is a no-op
 *    (slot-injection callback; cross-feature imports forbidden).
 *  - No CopyLinkToEntityButton / AuthorContainer — simplified.
 */
import { memo, useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import CloseIcon from '@mui/icons-material/Close';

const IconButtonAny = IconButton as React.ComponentType<
  React.ComponentProps<typeof IconButton> & { variant?: string }
>;

import { AgentConversationStarters } from './AgentConversationStarters';
import AgentHubLike from './AgentHubLike';
import { AgentWelcomeMessage } from './AgentWelcomeMessage';
import type { ApplicationData, AuthorData } from '../types';

export interface AgentModalProps {
  open: boolean;
  onClose: () => void;
  agent: ApplicationData;
}

const AgentModal = memo(({ open, onClose, agent }: AgentModalProps) => {
  const [, setShowContext] = useState(false);
  const [isSmallHeight] = useState(window.innerHeight <= 390);

  const name = useMemo(() => agent?.name || 'Untitled Agent', [agent?.name]);
  const description = useMemo(
    () => agent?.description || 'No description available.',
    [agent?.description],
  );

  const authors = useMemo(() => {
    const { authors = [], author = {} as AuthorData } = agent || {};
    return !authors?.length ? (author?.id ? [author] : []) : authors;
  }, [agent]);

  const handleStartConversation = useCallback(() => {
    // Slot-injection callback: no cross-feature imports into processes/chat.
    onClose();
  }, [onClose]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: styles.paper } }}
    >
      <Box sx={styles.mainPanel}>
        <DialogTitle sx={styles.dialogTitle}>
          <Box sx={styles.authorRow}>
            {authors.length > 0 && authors[0]?.name && (
              <Typography variant="bodyMedium" color="text.secondary">
                {authors[0].name}
              </Typography>
            )}
          </Box>
          <Box sx={styles.authorRow}>
            <AgentHubLike data={agent} />
            <IconButtonAny variant="elitea" color="secondary" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButtonAny>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={contentSx(isSmallHeight)}>
            <Box sx={styles.iconContainer}>
            {agent.icon_meta && (
              <Box
                component="img"
                src={(agent.icon_meta as Record<string, string>).url}
                alt={name}
                sx={styles.icon}
              />
            )}
            </Box>
            <Typography variant="headingMedium" color="text.secondary">
              {name}
            </Typography>
            <Typography variant="bodySmall2" sx={descriptionSx(isSmallHeight)}>
              {description}
            </Typography>
            <Typography
              variant="bodySmall"
              onClick={() => setShowContext(true)}
              sx={styles.showContext}
            >
              Show context
            </Typography>
            <Box sx={sectionsContainerSx(isSmallHeight)}>
              <AgentConversationStarters
                conversation_starters={agent?.conversation_starters || []}
              />
              <AgentWelcomeMessage welcome_message={agent?.welcome_message || ''} />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={styles.dialogActions}>
          <Button variant="elitea" color="primary" onClick={handleStartConversation}>
            Start conversation
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
});

AgentModal.displayName = 'AgentModal';

const styles: Record<string, SxProps<Theme>> = {
  dialog: {},
  paper: {
    width: '37.5rem',
    maxWidth: '37.5rem',
    height: '41.875rem',
    borderRadius: '1rem',
  },
  mainPanel: {
    width: '100%',
    height: '100%',
    borderRadius: 'calc(1rem - 1px)',
    display: 'flex',
    flexDirection: 'column',
  },
  dialogTitle: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '3.75rem',
    margin: 0,
  },
  authorRow: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  iconContainer: {
    display: 'flex',
    justifyContent: 'center',
    width: '2.5rem',
    height: '2.5rem',
  },
  icon: { width: '2.5rem', height: '2.5rem' },
  showContext: {
    cursor: 'pointer',
    color: 'primary.main',
    textAlign: 'center',
  },
  dialogActions: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: '.75rem 1.5rem !important',
    gap: '.75rem',
    height: '3.75rem',
  },
};

const contentSx = (isSmall: boolean): SxProps<Theme> => ({
  width: '100%',
  height: '100%',
  borderRadius: '1rem',
  padding: '1.5rem 2rem 2rem',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '1rem',
  flex: 1,
  minHeight: 0,
  overflow: isSmall ? 'auto' : 'hidden',
});

const descriptionSx = (isSmall: boolean): SxProps<Theme> => ({
  textAlign: 'center',
  color: 'text.metrics',
  ...(isSmall
    ? { width: '100%' }
    : {
        height: '2.5rem',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }),
});

const sectionsContainerSx = (isSmall: boolean): SxProps<Theme> => ({
  width: '100%',
  marginTop: '0.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1.5rem',
  flex: isSmall ? 'none' : 1,
  minHeight: isSmall ? 'auto' : 0,
  overflowY: isSmall ? 'visible' : 'auto',
});

export default AgentModal;
