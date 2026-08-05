import { useCallback } from 'react';

import { ChatParticipantType } from '@/shared/lib/chat';

/**
 * Ported from `apps/elitea-ui/src/hooks/chat/usePipelineCreation.js`.
 *
 * **DISCLOSED GAP — Google Analytics event tracking dropped.** The baseline
 * fires `trackEvent(GA_EVENT_NAMES.PIPELINE_CREATED_FROM_CHAT, {...})`
 * (`usePipelineCreation.js:13,17-23`) via `useTrackEvent` from `@/GA`. No
 * `GA`/event-tracking module exists anywhere in this app — same documented
 * gap `features/agents/model/useAgentCreation.ts`'s own doc comment already
 * establishes for the byte-for-byte-identical situation on the agent side.
 * Dropped entirely rather than inventing a sink; a one-line re-add once a
 * real analytics-event SDK lands.
 *
 * **Real, faithful difference from `useAgentCreation.ts` — not a
 * simplification.** The baseline's `usePipelineCreation.js` calls
 * `addNewParticipants([pipelineParticipant])` with NO added-participants
 * callback (unlike `useAgentCreation.js`, which awaits a callback to find
 * and activate the newly-added participant from the returned list). This
 * hook instead calls `onSetActiveParticipant` directly with the
 * already-known `pipelineParticipant` object — matching the baseline's own
 * control flow exactly (`usePipelineCreation.js:45-58`), not a port
 * shortcut.
 */

export interface CreatedPipelineResult {
  readonly id: number | string;
  readonly name?: string;
  readonly version_details?: {
    readonly id?: number | string;
  };
  readonly entity_meta?: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly entity_settings?: Readonly<Record<string, unknown>>;
}

/** The chat-participant shape `onPipelineCreated` builds from a freshly-created pipeline, matching `usePipelineCreation.js:26-43`. */
export type CreatedPipelineParticipant = CreatedPipelineResult & {
  readonly participantType: string;
  readonly entity_name: string;
  readonly entity_meta: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly entity_settings: Readonly<Record<string, unknown>>;
};

export interface UsePipelineCreationParams {
  readonly onPipelineEditorCreated?: (participant: CreatedPipelineParticipant) => void;
  readonly addNewParticipants?: (participants: readonly CreatedPipelineParticipant[]) => void;
  readonly onSetActiveParticipant?: (participant: CreatedPipelineParticipant) => void;
}

export interface UsePipelineCreationResult {
  readonly onPipelineCreated: (result: CreatedPipelineResult | undefined) => void;
}

/**
 * Manages the pipeline-creation-from-chat workflow: transforms the created
 * application into chat-participant shape, adds it to the conversation's
 * participants, activates it, and notifies the pipeline editor — same
 * control flow as the baseline (`usePipelineCreation.js:13-61`).
 */
export function usePipelineCreation({
  onPipelineEditorCreated,
  addNewParticipants,
  onSetActiveParticipant,
}: UsePipelineCreationParams): UsePipelineCreationResult {
  const onPipelineCreated = useCallback(
    (createdPipeline: CreatedPipelineResult | undefined) => {
      if (!createdPipeline) return;

      const pipelineParticipant: CreatedPipelineParticipant = {
        ...createdPipeline,
        participantType: ChatParticipantType.Pipelines,
        entity_name: ChatParticipantType.Applications,
        entity_meta: {
          ...createdPipeline.entity_meta,
          id: createdPipeline.id,
        },
        meta: {
          ...createdPipeline.meta,
          name: createdPipeline.name,
        },
        entity_settings: {
          ...createdPipeline.entity_settings,
          agent_type: 'pipeline',
          version_id: createdPipeline.version_details?.id,
        },
      };

      if (addNewParticipants) {
        addNewParticipants([pipelineParticipant]);
      }

      if (onSetActiveParticipant) {
        onSetActiveParticipant(pipelineParticipant);
      }

      if (onPipelineEditorCreated) {
        onPipelineEditorCreated(pipelineParticipant);
      }
    },
    [onPipelineEditorCreated, addNewParticipants, onSetActiveParticipant],
  );

  return { onPipelineCreated };
}
