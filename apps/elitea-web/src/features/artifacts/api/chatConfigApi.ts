/**
 * Hand-written client for `GET /elitea_core/chat_config/prompt_lib/{projectId}`.
 *
 * NOTE(#126): this replaces orval's `useGetChatConfig`. The `getChatConfig`
 * operation left `api/openapi/v2.yaml` when #126 step 1 deleted the routes
 * gated on the prototype indexer transport.
 *
 * NOTE(#194): the path is SERVED now, and by the current implementation
 * (`internal/api/v2/promptcontextreads`, vault-backed with its own auth and
 * `models.chat.conversation.details` permission resolution) — not by the
 * prototype eliteacore handler whose only registration sat inside the
 * never-assigned `ChatService` gate. Until then it answered 404 in every
 * deployment and every caller fell through to its own default.
 *
 * Response shape (verified live, not assumed): the body is the reader's exact
 * five-key object —
 *   {chat_max_upload_count, chat_max_upload_size_mb,
 *    chat_max_file_upload_size_mb, chat_max_image_upload_count,
 *    chat_max_image_upload_size_mb}
 * with JSON-number values. `eliteaFetch` wraps every response in orval's
 * `{data, status, headers}` envelope, so `envelope.data` below is that object,
 * and `readUploadLimit` (`../model/useArtifactUpload`) reads
 * `chat_max_file_upload_size_mb` off it. The prototype handler returned
 * `{models, default_model}` instead, which carries none of those keys — it
 * would have left the default in place even once mounted.
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
