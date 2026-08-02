/**
 * Phase-4 useRecommendations hook
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
export type RecommendationItem = {
  id: string;
  name: string;
  description?: string;
};

export type UseRecommendationsResult = {
  recommendations: RecommendationItem[];
  total: number;
  isFetching: boolean;
  isLoading: boolean;
};

export function useRecommendations(): UseRecommendationsResult {
  return {
    recommendations: [],
    total: 0,
    isFetching: false,
    isLoading: false,
  };
}
