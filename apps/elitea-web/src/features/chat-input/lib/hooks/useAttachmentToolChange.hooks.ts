import { useCallback } from 'react';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/
 * useAttachmentToolChange.hooks.js` (unit C3, "chat-input" cluster).
 *
 * NOT consumed by any file in this cluster itself — like
 * `useNewInputKeyDownHandler`/`useNewStartConversationInputKeyDownHandler`
 * (`useInputKeyDownHandler.hooks.ts`), the baseline never calls this from
 * `UserInput.jsx`/`NewChatInput.jsx` either; it is consumed one layer up,
 * by a future composition-root unit (C6-equivalent) wiring the internal
 * tools config dialog's "attachments toggled" callback to a participant
 * refetch. Exported from this slice's public barrel for that future
 * consumer, per this unit's own task brief.
 *
 * `activeParticipant` is typed as the RAW, snake_case chat-domain shape
 * (`entity_meta.id`), not the normalised `entities/participant` `Participant`
 * (camelCase `entityMeta.projectId`) — this hook, like the baseline, only
 * ever receives whatever raw participant object the eventual composition
 * root holds; only the one field it reads is modeled, matching this same
 * cluster's `ChatAttachmentsParticipantGate` precedent (`../../model/
 * chatAttachments.types.ts`) for narrow structural gate types.
 */
// Not exported (knip: no outside consumer by name) — only referenced as a
// nested field type of `UseAttachmentToolChangeParams` below.
interface AttachmentToolChangeParticipant {
  readonly entity_meta?: { readonly id?: string } | undefined;
}

export interface UseAttachmentToolChangeParams {
  readonly activeParticipant: AttachmentToolChangeParticipant | null | undefined;
  readonly refetchParticipantDetails?: (() => Promise<unknown>) | undefined;
}

export interface UseAttachmentToolChangeResult {
  /**
   * The pipeline-editor's "attachments toggled" callback passes the
   * ENTITY id it edited — which lines up with `activeParticipant.entity_meta
   * .id`, NEVER `activeParticipant.id` (the conversation-participant row
   * id) — baseline comment, preserved verbatim below.
   */
  readonly handleAttachmentToolChange: (participantId: string | undefined) => Promise<void>;
}

export function useAttachmentToolChange(params: UseAttachmentToolChangeParams): UseAttachmentToolChangeResult {
  const { activeParticipant, refetchParticipantDetails } = params;
  const activeEntityId = activeParticipant?.entity_meta?.id;

  const handleAttachmentToolChange = useCallback(
    async (participantId: string | undefined) => {
      // The chat editor callback for the pipeline path passes the entity id,
      // which corresponds to activeParticipant.entity_meta.id — NOT
      // activeParticipant.id (the latter is the conversation participant
      // row id and never matches).
      if (!activeEntityId || activeEntityId !== participantId) return;
      await refetchParticipantDetails?.();
    },
    [activeEntityId, refetchParticipantDetails],
  );

  return { handleAttachmentToolChange };
}
