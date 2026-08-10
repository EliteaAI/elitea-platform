/**
 * Hand-written client for `GET /elitea_core/chat_config/prompt_lib/{projectId}`.
 *
 * NOTE(#126): this replaces orval's `useGetChatConfig`. The `getChatConfig`
 * operation left `api/openapi/v2.yaml` when #126 step 1 deleted the routes
 * gated on the prototype indexer transport. The handler itself is
 * eliteacore's and is perfectly alive — but its ONLY registration sat inside
 * the `ChatService` gate, next to the chat Mount, and nothing ever assigned
 * that field, so the path has answered 404 in every deployment. Re-registering
 * it would be a behaviour change rather than deletion cleanup, so it is
 * tracked (#93/#194) instead of smuggled into the deletion.
 *
 * The request below is identical to the generated one, so callers behave
 * exactly as before: the query fails and they fall back to their defaults.
 */
import { useQuery } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';

export interface ChatConfigQueryResult {
  /** The raw chat-config payload; shape is read defensively by callers. */
  readonly data: unknown;
}

export function useChatConfig(projectId: string | undefined): ChatConfigQueryResult {
  const query = useQuery({
    queryKey: [`/elitea_core/chat_config/prompt_lib/${projectId ?? ''}`],
    queryFn: async () => {
      const envelope = await eliteaFetch<{ data: unknown }>(`/elitea_core/chat_config/prompt_lib/${projectId ?? ''}`);
      return envelope.data;
    },
    enabled: projectId !== undefined && projectId !== '',
  });
  return { data: query.data };
}
