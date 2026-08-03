import { useMemo } from 'react';

import NewParticipantList from './NewParticipantList';
import { useRecommendations } from '../lib/useRecommendations';

/**
 * Phase-5 RecommendationList — the "Frequently used" panel above the chat
 * composer. Wires `useRecommendations` (the dedicated, usage-ranked
 * recommendations endpoint) to `NewParticipantList`.
 */
export type RecommendationListProps = {
  onSelectParticipant: (participant: unknown) => void;
  existingParticipants?: unknown[];
  onClose?: () => void;
  /** Forwarded to `useRecommendations` — the recommendations endpoint is project-scoped. */
  projectId?: string | undefined;
};

/**
 * `activeConversation.participants` shape (`entities/conversation/lib/
 * wire.ts`'s `ChatParticipantWire`) — declared locally rather than imported
 * since that type isn't re-exported through `entities/conversation`'s
 * barrel (R-L3 forbids the deep import) and `entities/conversation` isn't
 * otherwise a dependency of this slice.
 */
interface ExistingParticipantWire {
  readonly entity_name?: string;
  readonly entity_meta?: { readonly id?: string; readonly project_id?: string };
}

const RecommendationList = ({
  onSelectParticipant,
  existingParticipants = [],
  onClose = () => {},
  projectId,
}: RecommendationListProps) => {
  const { recommendations, isLoading } = useRecommendations({ projectId });

  const existingParticipantUids = useMemo(
    () =>
      (existingParticipants as ExistingParticipantWire[]).map(
        (p) => `${p.entity_name}_${p.entity_meta?.id}_${p.entity_meta?.project_id}`,
      ),
    [existingParticipants],
  );

  return (
    <NewParticipantList
      onSelectParticipant={onSelectParticipant}
      isLoading={isLoading}
      participants={recommendations}
      existingParticipantUids={existingParticipantUids}
      onClose={onClose}
    />
  );
};

RecommendationList.displayName = 'RecommendationList';

export default RecommendationList;
