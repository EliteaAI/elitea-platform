import { useCallback } from 'react';

import NewParticipantList from './NewParticipantList';
import { useRecommendations } from '../lib/useRecommendations';

/**
 * Phase-4 RecommendationList
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
export type RecommendationListProps = {
  onSelectParticipant: (participant: unknown) => void;
  existingParticipants?: unknown[];
  onClose?: () => void;
};

const RecommendationList = ({
  onSelectParticipant,
  existingParticipants = [],
  onClose = () => {},
}: RecommendationListProps) => {
  const { recommendations, isLoading } = useRecommendations();

  const existingParticipantUids = useCallback(
    () =>
      (existingParticipants as Record<string, unknown>[]).map(
        p => `${p.participantType}_${p.id}`,
      ),
    [existingParticipants],
  );

  return (
    <NewParticipantList
      onSelectParticipant={onSelectParticipant}
      isLoading={isLoading}
      participants={recommendations}
      existingParticipantUids={existingParticipantUids()}
      onClose={onClose}
      title="Recommended"
    />
  );
};

RecommendationList.displayName = 'RecommendationList';

export default RecommendationList;
