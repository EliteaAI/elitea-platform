import { useCallback, useState } from 'react';

import { eliteaFetch } from '@/shared/api/generated/mutator';
import type { PredictResponse } from '@/shared/api/generated/model';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/agent/api/generateAgentDraftApi.js` (a
 * hand-built RTK Query `injectEndpoints` mutation, `POST /elitea_core/
 * generate_application_draft/prompt_lib/{projectId}`).
 *
 * **Two real, disclosed backend-shape gaps, both traced by reading
 * `applications.ts`/the generated model directly (not assumed):**
 *
 *  1. **Request body.** The baseline calls
 *     `useGenerateAgentDraftMutation()({projectId, user_description})`
 *     (`GenerateAgentModal.jsx:102`) — a bespoke `user_description` field.
 *     The endpoint's generated request type, `PredictRequest`
 *     (`predictRequest.zod.ts`), has no such field: `{input?, variables?,
 *     stream?, mode?}` (own doc comment: "NOTE(W2): internal/domain/predict/
 *     types.go:5-13, decoded in internal/api/v2/predict/handler.go:41-49" —
 *     the real Go route is the GENERIC predictor, not a bespoke draft
 *     endpoint; `generateAgentDraft`'s own generated doc comment confirms
 *     this: "request and response are the predict contract, not a bespoke
 *     draft shape"). Mapped `user_description -> input` here as the closest
 *     real semantic equivalent (the field the generic predictor actually
 *     reads as the user's prompt text) — a disclosed MAPPING, not an
 *     invented field.
 *  2. **Response body.** The baseline expects the draft fields directly
 *     (`name`/`description`/`welcome_message`/`conversation_starters` —
 *     see this slice's own `agentDraftValidation.helpers.ts`, which
 *     validates exactly that shape). The endpoint's generated response type
 *     is `PredictResponse` (`predictResponse.zod.ts`): `{message_group_uid,
 *     content?, is_streaming, usage?, tool_calls?, child_messages?}` — a raw
 *     chat-completion envelope, NOT a pre-parsed draft object. There is
 *     currently no generated endpoint that returns a structured agent
 *     draft; a caller must parse `content` (presumably the LLM's raw
 *     JSON-in-text reply) into an `AgentDraft` itself before this slice's
 *     `validateAgentDraft` can check it. Returning the raw
 *     `PredictResponse` here rather than pretending it is already an
 *     `AgentDraft` keeps that gap honest at the type level.
 *
 * NOTE(#126): this used to go through orval's
 * `getGenerateAgentDraftQueryOptions`. That operation was removed from
 * `api/openapi/v2.yaml` when #126 step 1 deleted the route behind it — it was
 * gated on a `RouterConfig.Predictor` nothing ever assigned, so
 * `POST /elitea_core/generate_application_draft/prompt_lib/{projectId}`
 * answered 404 in every deployment. The request issued below is identical to
 * the generated one, so this hook behaves exactly as it did; #194 tracks the
 * missing backend.
 */
export interface UseGenerateAgentDraftMutationArgs {
  readonly projectId: string;
  /** The baseline's `user_description` — mapped to the real `PredictRequest.input` field. See module doc comment, gap 1. */
  readonly user_description: string;
}

export interface UseGenerateAgentDraftMutationResult {
  readonly generateDraft: (args: UseGenerateAgentDraftMutationArgs) => Promise<PredictResponse | undefined>;
  readonly isLoading: boolean;
  readonly error: unknown;
  readonly reset: () => void;
}

/**
 * Imperative "generate an AI agent draft" action. Named `useGenerateAgentDraftMutation`
 * (not `useGenerateAgentDraft`) to match the baseline's own RTK Query hook
 * name — this app's generated client already exports an UNRELATED
 * `useGenerateAgentDraft` (a `useQuery`-shaped hook gated by `enabled`, per
 * this generated client's convention for every write endpoint — see
 * `entities/application-form/model/mutations.ts`'s doc comment); this
 * wrapper is the imperative, mutation-shaped call site callers actually
 * need (a "click to generate" button, not an auto-firing query).
 */
export function useGenerateAgentDraftMutation(): UseGenerateAgentDraftMutationResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  const generateDraft = useCallback(
    async ({ projectId, user_description }: UseGenerateAgentDraftMutationArgs): Promise<PredictResponse | undefined> => {
      setIsLoading(true);
      setError(undefined);
      try {
        // Error-envelope response variants (400/401/403) are never actually reachable here —
        // `eliteaFetch` throws `EliteaApiError` instead of resolving with them (mutator.ts's
        // §3.6 unwrap contract; same cast convention as `entities/application-form`'s hooks).
        const response = await eliteaFetch<{ data: PredictResponse }>(
          `/elitea_core/generate_application_draft/prompt_lib/${projectId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: user_description }),
          },
        );
        return response.data;
      } catch (caught) {
        setError(caught);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setError(undefined);
  }, []);

  return { generateDraft, isLoading, error, reset };
}
