import { useCallback } from 'react';

import { ChatParticipantType } from '@/shared/lib/chat';

/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useToolkitCreation.js` (74 lines).
 *
 * **Dropped, disclosed:** GA event tracking (`useTrackEvent`,
 * `GA_EVENT_NAMES.MCP_CREATED_FROM_CHAT`/`TOOLKIT_CREATED_FROM_CHAT`,
 * baseline lines 3,18,24-31) — no analytics-event SDK exists anywhere in
 * this app, the same documented gap `features/pipelines/model/
 * usePipelineCreation.ts`'s own doc comment and `features/agents/ui/
 * AgentEditor.tsx`'s own doc comment both already give for GA tracking.
 */

export interface ToolkitCreationResult {
  readonly id: string | number;
  readonly name: string;
  readonly type?: string;
  readonly project_id?: string | number;
  readonly is_mcp?: boolean;
  readonly version_details?: {
    readonly id?: string | number;
    readonly variables?: readonly unknown[];
    readonly meta?: { readonly icon_meta?: unknown };
  };
}

interface ToolkitAsParticipant {
  readonly entity_meta: { readonly id: string | number; readonly name: string; readonly project_id: string | number | undefined };
  readonly entity_settings: { readonly version_id: string | number | undefined; readonly variables: readonly unknown[]; readonly icon_meta: unknown };
  readonly meta: { readonly name: string; readonly mcp: boolean };
  readonly name: string;
}

interface CreatedToolkitParticipant extends ToolkitCreationResult {
  readonly participantType: string;
}

export interface UseToolkitCreationParams {
  /** The editor's own "creation completed" callback (switches the editor from create to edit mode) — baseline: `onToolkitEditorCreated` (`useEditToolkit`/`useEditToolkit.js`). */
  readonly onToolkitEditorCreated: (toolkit: ToolkitAsParticipant) => void;
  /** Adds the newly created toolkit to the conversation's participant list. */
  readonly addNewParticipants: (participants: readonly CreatedToolkitParticipant[]) => Promise<void>;
}

export interface UseToolkitCreationResult {
  readonly onToolkitCreated: (result: ToolkitCreationResult | undefined) => Promise<void>;
}

/**
 * Toolkit-creation completion handler for the chat canvas — transforms the
 * create endpoint's response into the editor's own participant shape and
 * adds it (inactive — toolkits are tools, not conversational entities) to
 * the conversation.
 */
export function useToolkitCreation({ onToolkitEditorCreated, addNewParticipants }: UseToolkitCreationParams): UseToolkitCreationResult {
  const onToolkitCreated = useCallback(
    async (result: ToolkitCreationResult | undefined): Promise<void> => {
      if (!result) return;

      const toolkitAsParticipant: ToolkitAsParticipant = {
        entity_meta: { id: result.id, name: result.name, project_id: result.project_id },
        entity_settings: {
          version_id: result.version_details?.id,
          variables: result.version_details?.variables ?? [],
          icon_meta: result.version_details?.meta?.icon_meta,
        },
        meta: { name: result.name, mcp: result.is_mcp ?? false },
        name: result.name,
      };

      // First, handle the editor's creation workflow (switch to edit mode, etc.)
      onToolkitEditorCreated(toolkitAsParticipant);

      const createdToolkit: CreatedToolkitParticipant = {
        participantType: ChatParticipantType.Toolkits,
        ...result,
      };

      // Add the toolkit to the conversation participants. Toolkits are not
      // set as active participants since they are tools, not conversational
      // entities — they become available in the toolkit dropdown for use but
      // are not auto-selected (baseline comment, `useToolkitCreation.js:61-62`).
      await addNewParticipants([createdToolkit]);
    },
    [addNewParticipants, onToolkitEditorCreated],
  );

  return { onToolkitCreated };
}
