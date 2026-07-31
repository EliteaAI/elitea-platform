/**
 * useCardLike — zustand-backed hook for managing card-like state.
 *
 * Replaces the old Redux-based `Like` component with a lightweight
 * zustand store. Used by agents-hub `AgentHubLike` and any future
 * card-surface like button.
 *
 * @public Wave-2 surface: consumed by pages/agents-hub/ui/AgentHubLike.
 */
import { useCallback, useRef, useState } from 'react';

import { create } from 'zustand';

/* ── Store ──────────────────────────────────────────────────────────── */

interface LikeState {
  likedStates: Record<string, boolean>;
  likeCounts: Record<string, number>;
  toggleLike: (id: string) => void;
  setLikeState: (id: string, liked: boolean) => void;
  incrementCount: (id: string) => void;
  decrementCount: (id: string) => void;
}

const useLikeStore = create<LikeState>(set => ({
  likedStates: {},
  likeCounts: {},
  toggleLike: id =>
    set(state => ({
      likedStates: { ...state.likedStates, [id]: !state.likedStates[id] },
    })),
  setLikeState: (id, liked) =>
    set(state => ({
      likedStates: { ...state.likedStates, [id]: liked },
    })),
  incrementCount: id =>
    set(state => ({
      likeCounts: { ...state.likeCounts, [id]: (state.likeCounts[id] || 0) + 1 },
    })),
  decrementCount: id =>
    set(state => ({
      likeCounts: { ...state.likeCounts, [id]: Math.max(0, (state.likeCounts[id] || 0) - 1) },
    })),
}));

/* ── Hook ───────────────────────────────────────────────────────────── */

export interface UseCardLikeOptions {
  applicationId: string;
  initialLiked?: boolean;
  initialCount?: number;
  onLikeSuccess?: (applicationId: string, isLiked: boolean, likeCount: number) => void;
}

export function useCardLike({
  applicationId,
  initialLiked = false,
  initialCount = 0,
  onLikeSuccess,
}: UseCardLikeOptions) {
  const { likedStates, likeCounts, setLikeState, incrementCount, decrementCount } = useLikeStore();
  const isLiked = likedStates[applicationId] ?? initialLiked;
  const likeCount = likeCounts[applicationId] ?? initialCount;
  const [isToggling, setIsToggling] = useState(false);
  const prevLikedRef = useRef(isLiked);

  // Keep prevLikedRef in sync to detect actual changes
  if (prevLikedRef.current !== isLiked) {
    prevLikedRef.current = isLiked;
  }

  const toggleLike = useCallback(async () => {
    if (isToggling) return;
    setIsToggling(true);
    const newLiked = !isLiked;
    setLikeState(applicationId, newLiked);
    if (newLiked) {
      incrementCount(applicationId);
    } else {
      decrementCount(applicationId);
    }
    onLikeSuccess?.(
      applicationId,
      newLiked,
      newLiked ? likeCount + 1 : Math.max(0, likeCount - 1),
    );
    setIsToggling(false);
  }, [isLiked, isToggling, applicationId, setLikeState, incrementCount, decrementCount, onLikeSuccess, likeCount]);

  const updateServerState = useCallback(
    (liked: boolean, newCount: number) => {
      setLikeState(applicationId, liked);
      if (newCount > likeCount) {
        incrementCount(applicationId);
      } else if (newCount < likeCount) {
        decrementCount(applicationId);
      }
    },
    [applicationId, setLikeState, incrementCount, decrementCount, likeCount],
  );

  return { isLiked, likeCount, isToggling, toggleLike, updateServerState };
}
