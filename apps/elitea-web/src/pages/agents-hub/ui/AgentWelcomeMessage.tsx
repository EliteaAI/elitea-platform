/* oxlint-disable i18next/no-literal-string -- Wave-2 prototype: UI copy not yet wired through i18n shim (unit S8). REMOVER: S8. */
/**
 * Agent Welcome Message — displays the agent's welcome text.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/agent-hub/ui/AgentWelcomeMessage.jsx`.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export interface AgentWelcomeMessageProps {
  welcome_message?: string;
}

export const AgentWelcomeMessage = memo(({ welcome_message }: AgentWelcomeMessageProps) => (
  <Box sx={styles.container}>
    <Typography variant="subtitle" sx={styles.header}>
      Welcome Message
    </Typography>
    {welcome_message?.trim() ? (
      <Typography variant="bodyMedium" sx={styles.text}>
        {welcome_message}
      </Typography>
    ) : (
      <Typography variant="bodySmall" sx={styles.empty}>
        No welcome message set – the agent will start without a greeting.
      </Typography>
    )}
  </Box>
));

AgentWelcomeMessage.displayName = 'AgentWelcomeMessage';

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    width: '100%',
    flex: '0 1 auto',
    alignItems: 'center',
    maxHeight: '12.5rem',
  },
  header: { color: 'text.tertiary', flexShrink: 0 },
  text: {
    color: 'text.secondary',
    width: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    wordBreak: 'break-word',
    WebkitLineClamp: 8,
  },
  empty: { color: 'text.tertiary', textAlign: 'center' },
};

export default AgentWelcomeMessage;
