import { useCallback } from 'react';

import { ChatParticipantType } from '@/shared/lib/chat';

/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useAgentCreation.js`.
 *
 * **DISCLOSED GAP — Google Analytics event tracking dropped.** The baseline
 * fires `trackEvent(GA_EVENT_NAMES.AGENT_CREATED_FROM_CHAT, {...})`
 * (`useAgentCreation.js:19,25-31`) via `useTrackEvent` from `@/GA`. No `GA`/
 * event-tracking module, `useTrackEvent` hook, or `GA_EVENT_NAMES`/
 * `GA_EVENT_PARAMS` constant catalogue exists anywhere in this app (grepped
 * the full tree — the only "GA"/analytics surface is `features/analytics`,
 * which is the analytics-DASHBOARD feature for viewing usage data, not an
 * event-emission SDK). There is nothing to wire this call to; rather than
 * inventing a tracking sink or silently keeping a call to a symbol this
 * app has no equivalent of, the tracking call is dropped entirely. If a
 * real analytics-event SDK lands later, re-adding this call is a one-line
 * change at the single call site below.
 */

export interface CreatedAgentResult {
  readonly id: number | string;
  readonly name?: string;
  readonly project_id?: string | number;
  readonly version_details?: {
    readonly id?: number | string;
    readonly variables?: readonly unknown[];
    readonly meta?: { readonly icon_meta?: unknown };
  };
}

/** The chat-participant shape `onAgentCreated` builds from a freshly-created agent, matching `useAgentCreation.js:34-49`. */
export interface CreatedAgentParticipant {
  readonly entity_meta: {
    readonly id: number | string;
    readonly name: string | undefined;
    readonly project_id: string | number | undefined;
  };
  readonly entity_settings: {
    readonly version_id: number | string | undefined;
    readonly variables: readonly unknown[];
    readonly icon_meta: unknown;
  };
  readonly meta: { readonly name: string | undefined };
  readonly name: string | undefined;
}

/** The full chat-participant-with-type shape passed to `addNewParticipants`, matching `useAgentCreation.js:54-58`. */
export type CreatedAgentAsParticipant = CreatedAgentResult & { readonly participantType: string };

export interface AddedParticipantLike {
  readonly entity_name?: string;
  readonly entity_meta?: { readonly id?: number | string };
}

export interface UseAgentCreationParams {
  readonly onAgentEditorCreated: (participant: CreatedAgentParticipant) => void;
  readonly addNewParticipants: (
    participants: readonly CreatedAgentAsParticipant[],
    onAdded: (added: readonly AddedParticipantLike[]) => void,
  ) => Promise<void>;
  readonly onSetActiveParticipant: (participant: AddedParticipantLike) => void;
}

export interface UseAgentCreationResult {
  readonly onAgentCreated: (result: CreatedAgentResult | undefined) => Promise<void>;
}

/**
 * Manages the agent-creation-from-chat workflow: transforms the created
 * application into chat-participant shape, opens the editor onto it, adds
 * it to the conversation's participants, and auto-activates it. Same
 * control flow as the baseline, `console.error` on the add-participant
 * failure preserved verbatim (`useAgentCreation.js:76-79`).
 */
export function useAgentCreation({
  onAgentEditorCreated,
  addNewParticipants,
  onSetActiveParticipant,
}: UseAgentCreationParams): UseAgentCreationResult {
  const onAgentCreated = useCallback(
    async (result: CreatedAgentResult | undefined) => {
      if (!result) return;

      const agentAsParticipant: CreatedAgentParticipant = {
        entity_meta: {
          id: result.id,
          name: result.name,
          project_id: result.project_id,
        },
        entity_settings: {
          version_id: result.version_details?.id,
          variables: result.version_details?.variables ?? [],
          icon_meta: result.version_details?.meta?.icon_meta ?? null,
        },
        meta: { name: result.name },
        name: result.name,
      };

      onAgentEditorCreated(agentAsParticipant);

      const createdAgent: CreatedAgentAsParticipant = {
        participantType: ChatParticipantType.Applications,
        ...result,
      };

      try {
        await addNewParticipants([createdAgent], (addedParticipants) => {
          if (addedParticipants && addedParticipants.length > 0) {
            const addedAgent = addedParticipants.find(
              (p) => p.entity_name === ChatParticipantType.Applications && p.entity_meta?.id === result.id,
            );
            if (addedAgent) {
              onSetActiveParticipant(addedAgent);
            }
          }
        });
      } catch (error) {
        console.error('Error adding participant:', error);
      }
    },
    [addNewParticipants, onSetActiveParticipant, onAgentEditorCreated],
  );

  return { onAgentCreated };
}
