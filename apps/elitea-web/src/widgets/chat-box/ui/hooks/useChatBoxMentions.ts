/**
 * Split out of `ChatBox.tsx` to stay under the file-length/component-props
 * budgets (§3.5) — "@" mention -> send-to-user/everyone routing, and skill
 * ("~") mention selection.
 */
import { useCallback } from 'react';

import type { useChatBoxState, ResolvedUserMention } from './useChatBoxState';

export interface UseChatBoxMentionsParams {
  readonly state: ReturnType<typeof useChatBoxState>;
  readonly onChangeParticipant: ((participant: unknown) => void) | undefined;
}

export interface UseChatBoxMentionsResult {
  readonly handleMentionChange: (mentions: readonly { readonly user: unknown; readonly isValid: boolean }[]) => void;
  readonly handleSelectUserMention: (user: unknown) => void;
  readonly handleSelectSkillTool: (toolName: string | null) => void;
}

export function useChatBoxMentions({ state, onChangeParticipant }: UseChatBoxMentionsParams): UseChatBoxMentionsResult {
  const handleMentionChange = useCallback(
    (mentions: readonly { readonly user: unknown; readonly isValid: boolean }[]) => {
      const mentionedEveryone = mentions.find((m) => (m.user as ResolvedUserMention | undefined)?.id === '@everyone');
      if (mentionedEveryone) {
        state.setIsMentioningEveryone(true);
        state.setSelectedUsers([]);
        onChangeParticipant?.(undefined);
        return;
      }
      const mentionedUsers = mentions.filter((m) => m.isValid && m.user);
      state.setIsMentioningEveryone(false);
      state.setSelectedUsers(mentionedUsers.map((m) => m.user as ResolvedUserMention));
      if (mentionedUsers.length > 0) onChangeParticipant?.(undefined);
    },
    [state, onChangeParticipant],
  );

  const handleSelectUserMention = useCallback(
    (user: unknown) => { state.onSelectUserMention(user as ResolvedUserMention); },
    [state],
  );

  const handleSelectSkillTool = useCallback(
    (toolName: string | null) => {
      if (toolName === null) { state.skill.resetSkill(); return; }
      const item = state.skill.filteredItems.find((i) => i.name === toolName);
      if (item) state.skill.onSelectSkill(item);
    },
    [state.skill],
  );

  return { handleMentionChange, handleSelectUserMention, handleSelectSkillTool };
}
