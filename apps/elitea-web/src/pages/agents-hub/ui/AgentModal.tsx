/* oxlint-disable i18next/no-literal-string, elitea/ad-hoc-radius, elitea/no-important-sx -- Wave-2 prototype: UI copy from ported baseline (S8 pending), ad-hoc radii and !important from baseline CSS. REMOVER: S8 + token pass. */
/**
 * Agent Modal — detail dialog for a selected agent.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent-hub/ui/AgentModal.jsx`.
 *
 * Deviations:
 *  - No tour IDs.
 *  - No CopyLinkToEntityButton / AuthorContainer — simplified.
 *  - "Start conversation" / conversation-starter clicks: no direct Redux
 *    dispatch / `processes/chat` import (`pages/` may not import
 *    `processes/` — `.dependency-cruiser.cjs`'s
 *    `LAYERS_ABOVE.pages = ['app', 'processes']`). Adversarial-review fix
 *    (cluster A13-agents-hub, finding 3) turned the PREVIOUS bare no-op
 *    into an actual slot: an optional `onStartConversation` prop is called
 *    when supplied; otherwise this falls back to a plain SPA navigation to
 *    `/chat` (same disclosed pattern `pages/onboarding/Onboarding.tsx`'s
 *    `handleJumpIn` and `widgets/sidebar/ui/NotificationButton.tsx`'s
 *    `handleClick` already use for the identical "can't reach
 *    `processes/chat` from here" constraint) — real, observable navigation
 *    instead of nothing happening. Both paths now always close the modal
 *    (the starter-pill path previously did not). Pre-selecting THIS agent
 *    for the new conversation still needs work outside this cluster's file
 *    scope: `routes/_shell/chat.tsx`'s `validateSearch` would need an
 *    `agentId`/`starter` param added to `pickParams(...)`, and
 *    `processes/chat`'s `ChatWithEditors` would need to read it and seed a
 *    new conversation with this public agent (old-app parity:
 *    `actions.setSelectedAgentInfo` + `navigate(Chat, {state})}`) — wire a
 *    real `onStartConversation` callback down from wherever a route
 *    eventually mounts `<AgentHub/>` once that lands.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

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

import { useNavigate } from '@tanstack/react-router';

const IconButtonAny = IconButton as React.ComponentType<
  React.ComponentProps<typeof IconButton> & { variant?: string }
>;

import { AgentConversationStarters } from './AgentConversationStarters';
import AgentHubLike from './AgentHubLike';
import { AgentWelcomeMessage } from './AgentWelcomeMessage';
import { useAgentVersionDetail } from '../useAgentVersionDetail';
import type { ApplicationData, AuthorData } from '../types';

/** Small-height layout threshold (baseline: `AgentModal.jsx`'s `window.innerHeight <= 390`). */
const SMALL_HEIGHT_BREAKPOINT_PX = 390;

/** Narrows the opaque `ConversationStarters` wire array (`zod.unknown()[]` — see `conversationStarters.zod.ts`'s own NOTE(W2)) down to the `string[]` the UI actually renders, dropping any non-string entry instead of casting through it. */
function toStringArray(value: unknown[] | undefined): string[] {
  if (!value) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export interface AgentModalProps {
  open: boolean;
  onClose: () => void;
  agent: ApplicationData;
  /**
   * Real chat-launch injection point (see this file's module doc comment
   * for why it defaults instead of dispatching into `processes/chat`
   * directly). Called with the selected agent and, for a starter-pill
   * click, the starter text.
   */
  onStartConversation?: ((agent: ApplicationData, starter?: string) => void) | undefined;
}

const AgentModal = memo(({ open, onClose, agent, onStartConversation }: AgentModalProps) => {
  const navigate = useNavigate();
  const [, setShowContext] = useState(false);
  const [isSmallHeight, setIsSmallHeight] = useState(() => window.innerHeight <= SMALL_HEIGHT_BREAKPOINT_PX);

  // Adversarial-review fix (cluster A13-agents-hub, finding 11): the
  // baseline (`AgentModal.jsx`'s `checkHeight` + resize listener) keeps
  // this live across a resize; the previous port computed it once at mount
  // and never updated it.
  useEffect(() => {
    const checkHeight = (): void => setIsSmallHeight(window.innerHeight <= SMALL_HEIGHT_BREAKPOINT_PX);
    window.addEventListener('resize', checkHeight);
    return () => window.removeEventListener('resize', checkHeight);
  }, []);

  // Adversarial-review fix (cluster A13-agents-hub, finding 2): fetch the
  // agent's real version detail so Welcome Message / Conversation Starters
  // below can render actual data instead of always falling back to their
  // empty state.
  const { versionDetails } = useAgentVersionDetail(agent.id, agent.version_name);
  const welcomeMessage = versionDetails?.welcome_message || agent.welcome_message || '';
  const conversationStarters = useMemo(
    () => (versionDetails?.conversation_starters?.length ? toStringArray(versionDetails.conversation_starters) : (agent.conversation_starters ?? [])),
    [versionDetails?.conversation_starters, agent.conversation_starters],
  );

  const name = useMemo(() => agent?.name || 'Untitled Agent', [agent?.name]);
  const description = useMemo(
    () => agent?.description || 'No description available.',
    [agent?.description],
  );

  const authors = useMemo(() => {
    const { authors = [], author = {} as AuthorData } = agent || {};
    return !authors?.length ? (author?.id ? [author] : []) : authors;
  }, [agent]);

  const launchConversation = useCallback(
    (starter?: string) => {
      if (onStartConversation) {
        onStartConversation(agent, starter);
      } else {
        void navigate({ to: '/chat' });
      }
      onClose();
    },
    [agent, onClose, onStartConversation, navigate],
  );

  const handleStartConversation = useCallback(() => {
    launchConversation();
  }, [launchConversation]);

  const handleSelectStarter = useCallback(
    (starter: string) => {
      launchConversation(starter);
    },
    [launchConversation],
  );

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
                conversation_starters={conversationStarters}
                onSelectStarter={handleSelectStarter}
              />
              <AgentWelcomeMessage welcome_message={welcomeMessage} />
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
