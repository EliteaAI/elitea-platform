import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { Participant } from '@/entities/participant';

import { AgentEditorPanel } from './AgentEditorPanel';
import type { AgentEditorPanelProps } from './AgentEditorPanel.types';
import type { NewChatInputSlots } from './NewChatInput.types';

/**
 * The footer's button row, factored out of `NewChatInput.tsx` for the same
 * §3.5 complexity-budget reason as `UserInput.tsx`'s own sub-components.
 * Baseline: `NewChatInput.jsx`'s `slots.footer` JSX block.
 *
 * `slots.attachmentButton`/`slots.internalToolsConfig` are rendered
 * unconditionally (no `fromTheChat`/`hideAttachments`/`isAgentsPage` gate
 * on this side) — those baseline conditions decided WHICH C6 component
 * flavour to build; now that the whole area is one injected `ReactNode`
 * slot, that decision belongs entirely to whatever composition-root unit
 * builds the slot's content (passing `undefined` is how it opts out).
 * `AgentEditorPanel` vs. `slots.modelSelector` is the one branch THIS
 * cluster still owns — see this component's own `isAgentsPage` prop.
 */
export interface NewChatInputFooterContentProps {
  readonly slots: NewChatInputSlots;
  readonly isAgentsPage: boolean;
  readonly activeParticipant: Participant | undefined;
  readonly agentEditorProps: AgentEditorPanelProps;
}

function isApplicationOrPipeline(participant: Participant | undefined): boolean {
  return participant?.entityName === 'application' || participant?.entityName === 'pipeline';
}

export function NewChatInputFooterContent(props: NewChatInputFooterContentProps): ReactNode {
  const { slots, isAgentsPage, activeParticipant, agentEditorProps } = props;

  const showAgentEditorPanel = isApplicationOrPipeline(activeParticipant) && !isAgentsPage;
  const showModelSelector = isAgentsPage || !activeParticipant;

  return (
    <Box sx={rowSx}>
      <Box sx={leftSx}>
        {slots.attachmentButton}
        {slots.internalToolsConfig}
      </Box>
      <Box sx={rightSx}>
        {showAgentEditorPanel && <AgentEditorPanel {...agentEditorProps} />}
        {!showAgentEditorPanel && showModelSelector && slots.modelSelector}
        {slots.voiceButton}
      </Box>
    </Box>
  );
}

const rowSx: SxProps<Theme> = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: { xs: '.125rem', sm: '.5rem' },
  justifyContent: 'space-between',
  maxWidth: '100%',
  overflow: 'hidden',
};

const leftSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: { xs: '.25rem', sm: '.5rem' },
  flexShrink: 0,
};

const rightSx: SxProps<Theme> = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: { xs: '.25rem', sm: '.5rem' },
  minWidth: 0,
  flexShrink: 1,
  maxWidth: '100%',
  overflow: 'hidden',
};
