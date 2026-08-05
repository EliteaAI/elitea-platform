/**
 * Split out of `ChatBox.tsx` to stay under the file-length/component-props/
 * complexity budgets (§3.5) — the conditionally-rendered popups above
 * `NewChatInput`: the participants recommendation list, "@" user-mention
 * list, "/" toolkit slash-suggestion list, and "~" skill-mention list.
 * Props are grouped into option objects (one per popup) to stay under the
 * component-props budget, matching the pattern established across this Wave.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import { SlashSuggestionList, UserMentionList } from '@/features/chat-input';
import { RecommendationList } from '@/features/chat-recommendations';
import { MentionToolList } from '@/shared/ui/MentionToolList';

import { optField } from './ChatBox.helpers';
import { useNoopValidateToolkitQuery, useSlashToolkitDetailsQuery } from './hooks/useChatBoxSlashQueries';
import type { useChatBoxState } from './hooks/useChatBoxState';

type ChatBoxState = ReturnType<typeof useChatBoxState>;

interface ChatBoxPopupsRecommendations {
  readonly show: boolean;
  readonly onSelectParticipant: (participant: unknown) => void;
  readonly onClose: () => void;
  readonly existingParticipants: readonly unknown[];
  readonly projectId: string | undefined;
}

interface ChatBoxPopupsUserMentions {
  readonly isProcessingAtSymbol: boolean;
  readonly hasOtherUsers: boolean;
  readonly users: ChatBoxState['users'];
  readonly atQuery: string;
  readonly onSelectUser: (user: unknown) => void;
  readonly onClose: () => void;
}

interface ChatBoxPopupsSkill {
  readonly isActive: boolean;
  readonly filteredItems: ChatBoxState['skill']['filteredItems'];
  readonly highlightedIndex: ChatBoxState['skill']['highlightedIndex'];
  readonly onSelectTool: (toolName: string | null) => void;
}

export interface ChatBoxPopupsProps {
  readonly recommendations: ChatBoxPopupsRecommendations;
  readonly userMentions: ChatBoxPopupsUserMentions;
  readonly slash: ChatBoxState['slash'];
  readonly skill: ChatBoxPopupsSkill;
}

export function ChatBoxPopups({ recommendations, userMentions, slash, skill }: ChatBoxPopupsProps): ReactNode {
  return (
    <>
      {recommendations.show && (
        <Box sx={{ mb: 1 }}>
          <RecommendationList
            onSelectParticipant={recommendations.onSelectParticipant}
            existingParticipants={[...recommendations.existingParticipants]}
            onClose={recommendations.onClose}
            projectId={recommendations.projectId}
          />
        </Box>
      )}
      {userMentions.isProcessingAtSymbol && userMentions.hasOtherUsers && (
        <Box sx={{ mb: 1 }}>
          <UserMentionList
            users={userMentions.users}
            query={userMentions.atQuery}
            onSelectUser={userMentions.onSelectUser}
            onClose={userMentions.onClose}
          />
        </Box>
      )}
      {slash.phase !== 'idle' && (
        <Box sx={{ mb: 1 }}>
          <SlashSuggestionList
            phase={slash.phase}
            toolkitQuery={slash.toolkitQuery}
            toolQuery={slash.toolQuery}
            selectedToolkit={slash.selectedToolkit}
            isQueryFinal={slash.isQueryFinal}
            onSelectToolkit={slash.onSelectToolkit}
            onSelectTool={slash.onCommitMention}
            onClose={slash.resetSlash}
            participantToolkits={slash.participantToolkits}
            isMcpVisible={slash.isMcpVisible}
            activeIndex={slash.activeIndex}
            setActiveIndex={slash.setActiveIndex}
            itemCountRef={slash.itemCountRef}
            onConfirmActiveRef={slash.onConfirmActiveRef}
            useValidateToolkitQuery={useNoopValidateToolkitQuery}
            useToolkitDetailsQuery={useSlashToolkitDetailsQuery}
          />
        </Box>
      )}
      {skill.isActive && (
        <Box sx={{ mb: 1 }}>
          <MentionToolList
            tools={skill.filteredItems.map((item) => ({ name: item.name, ...optField('description', item.description) }))}
            toolkitName="Skill"
            onSelectTool={skill.onSelectTool}
            highlightedIndex={skill.highlightedIndex}
          />
        </Box>
      )}
    </>
  );
}
