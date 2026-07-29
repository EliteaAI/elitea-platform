/**
 * Hand-written client for the participant-scoped conversation mutations
 * (unit C1). Source: `apps/elitea-ui/src/[fsd]/features/chat/api/
 * chat.api.js:124-184` (`addParticipantIntoConversation`/
 * `deleteParticipantFromConversation`/`updateParticipantSettings`/
 * `updateParticipantLlmSettings` RTK Query endpoints).
 *
 * WHY HAND-WRITTEN, NOT GENERATED: none of `chat.api.js`'s 28
 * `/elitea_core/conversation(s)/...`-family endpoints appear in
 * `services/elitea-main/api/openapi/v2.yaml`, so orval never generates a
 * client for them — a documented spec-coverage gap (mission preamble),
 * NOT a backend gap: every route below IS real and wired
 * (`services/elitea-main/internal/api/router.go:425-428`,
 * `internal/api/v2/conversations/handler.go`). Same pattern already
 * precedented twice against this exact backend domain —
 * `features/pipelines/api/aiAssistantPredict.ts`'s `stopLlmTask` and
 * `features/toolkits/indexes/api/indexesApi.ts`'s
 * `getIndexHistoryConversationDetails` — this file follows their
 * `eliteaFetch`-based `fetchData<T>` unwrap convention exactly. Per R-A5,
 * every endpoint below is reported for merge into
 * `src/shared/api/endpoints.manifest.json` as `source: "handwritten"`
 * (not edited directly here — see this unit's report).
 *
 * TanStack Query replaces RTK Query's `invalidatesTags`: there is no
 * generated or hand-written `conversationDetails` query anywhere in this
 * app yet (the sibling two endpoints above are the only handwritten chat-
 * domain entries so far, and neither is `conversationDetails`), so there is
 * no established query-key convention to invalidate against. Each mutation
 * below still calls `queryClient.invalidateQueries` against a LOCAL,
 * documented key shape (`['chat', 'conversation', 'details', projectId,
 * conversationId]`) so a future `conversationDetails`-query-building unit
 * (chat.api.js's remaining 24 endpoints, out of this unit's scope) gets
 * working invalidation for free by keying its own query the same way —
 * flagged here rather than silently wired to nothing.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';

import type { Participant } from '../model/types';
import { normaliseParticipants } from '../lib/normalise';
import type { ParticipantWire } from '../lib/normalise';

async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options);
  return envelope.data;
}

function conversationDetailsQueryKey(projectId: string, conversationId: string) {
  return ['chat', 'conversation', 'details', projectId, conversationId] as const;
}

/* ── addParticipantIntoConversation — POST elitea_core/participants/prompt_lib/{projectId}/{conversationId} ── */

/**
 * One wire-shaped participant-to-add entry — `entity_name`/`entity_meta`/
 * `entity_settings` (chat.api.js:124-137's `participants` body verbatim,
 * shape confirmed against `AddParticipant`'s repo write path,
 * `internal/infra/db/repos/conversations.go:241-267`: `entity_name`,
 * `entity_meta`, `entity_settings` are the only keys read off each item).
 * Not part of this slice's public API (unexported: only referenced by
 * `AddParticipantParams.participants` below).
 */
interface ParticipantAddInput {
  readonly entity_name: string;
  readonly entity_meta?: Readonly<Record<string, unknown>>;
  readonly entity_settings?: Readonly<Record<string, unknown>>;
}

export interface AddParticipantParams {
  readonly projectId: string | number;
  readonly conversationId: string;
  /**
   * MUST be a JSON array — `AddParticipant`'s handler decodes the body as
   * `[]map[string]any` and 400s on anything else (handler.go:551-560; the
   * handler's own `// Try as single object` comment is dead code, there is
   * no actual single-object fallback). `chat.api.js`'s RTK mutation always
   * passed its `participants` argument straight through as the body, so
   * this constraint was already implicit at every real call site.
   */
  readonly participants: readonly ParticipantAddInput[];
}

/** Response: the conversation's full, refreshed participant list (handler.go:569-571). */
export async function addParticipantIntoConversation(params: AddParticipantParams): Promise<Participant[]> {
  const { projectId, conversationId, participants } = params;
  const wire = await fetchData<readonly ParticipantWire[]>(
    `/elitea_core/participants/prompt_lib/${String(projectId)}/${conversationId}`,
    { method: 'POST', body: JSON.stringify(participants), headers: { 'Content-Type': 'application/json' } },
  );
  return normaliseParticipants(wire);
}

export function useAddParticipantMutation(): UseMutationResult<Participant[], Error, AddParticipantParams> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addParticipantIntoConversation,
    onSuccess: (_data, variables) =>
      void queryClient.invalidateQueries({
        queryKey: conversationDetailsQueryKey(String(variables.projectId), variables.conversationId),
      }),
  });
}

/* ── deleteParticipantFromConversation — DELETE elitea_core/participant/prompt_lib/{projectId}/{conversationId}/{participantId} ── */

export interface DeleteParticipantParams {
  readonly projectId: string | number;
  readonly conversationId: string;
  readonly id: string;
}

/** `RemoveParticipant` returns `204 No Content` (handler.go:574-583) — resolves to `void`, not an echoed body. */
export async function deleteParticipantFromConversation(params: DeleteParticipantParams): Promise<void> {
  const { projectId, conversationId, id } = params;
  await eliteaFetch<unknown>(
    `/elitea_core/participant/prompt_lib/${String(projectId)}/${conversationId}/${id}`,
    { method: 'DELETE' },
  );
}

export function useDeleteParticipantMutation(): UseMutationResult<void, Error, DeleteParticipantParams> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteParticipantFromConversation,
    onSuccess: (_data, variables) =>
      void queryClient.invalidateQueries({
        queryKey: conversationDetailsQueryKey(String(variables.projectId), variables.conversationId),
      }),
  });
}

/* ── updateParticipantSettings — PUT elitea_core/entity_settings/prompt_lib/{projectId}/{conversationId}/{participantId} ── */

export interface UpdateParticipantSettingsParams {
  readonly projectId: string | number;
  readonly conversationId: string;
  readonly participantId: string;
  /** Arbitrary entity-settings patch — `chat.api.js:150-165`'s `...body` spread (everything but the three path/id fields). */
  readonly settings: Readonly<Record<string, unknown>>;
}

/**
 * Response is `{entity_settings: <echoed body>}` (handler.go:585-625), NOT
 * the conversation. `UpdateEntitySettings` additionally strips
 * `llm_settings` server-side when the participant is a non-published
 * agent's `application` (handler.go:595-618) — the echoed body reflects
 * that stripping, so callers should read this return value rather than
 * assuming their own request body was applied verbatim.
 */
export async function updateParticipantSettings(
  params: UpdateParticipantSettingsParams,
): Promise<Readonly<Record<string, unknown>>> {
  const { projectId, conversationId, participantId, settings } = params;
  const wire = await fetchData<{ readonly entity_settings: Readonly<Record<string, unknown>> }>(
    `/elitea_core/entity_settings/prompt_lib/${String(projectId)}/${conversationId}/${participantId}`,
    { method: 'PUT', body: JSON.stringify(settings), headers: { 'Content-Type': 'application/json' } },
  );
  return wire.entity_settings;
}

export function useUpdateParticipantSettingsMutation(): UseMutationResult<
  Readonly<Record<string, unknown>>,
  Error,
  UpdateParticipantSettingsParams
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateParticipantSettings,
    onSuccess: (_data, variables) =>
      void queryClient.invalidateQueries({
        queryKey: conversationDetailsQueryKey(String(variables.projectId), variables.conversationId),
      }),
  });
}

/* ── updateParticipantLlmSettings — PATCH elitea_core/entity_settings/prompt_lib/{projectId}/{conversationId} ── */

export interface UpdateParticipantLlmSettingsParams {
  readonly projectId: string | number;
  readonly conversationId: string;
  readonly llm_settings: Readonly<Record<string, unknown>>;
}

/**
 * **REAL, DISCLOSED BACKEND/CLIENT CONTRACT MISMATCH — not silently fixed.**
 * `chat.api.js:171-184`'s `updateParticipantLlmSettings` PATCHes this exact
 * URL with body `{llm_settings}` (a single JSON OBJECT). The Go route this
 * URL now resolves to is `BatchUpdateEntitySettings`
 * (`internal/api/router.go:428`, `internal/api/v2/conversations/
 * handler.go:663-676`), which decodes the body as `var body []map[string]
 * any` — a JSON ARRAY of PER-PARTICIPANT settings maps, each keyed by a
 * `participant_id` field the handler pulls out and deletes before applying
 * the rest as that one participant's `entity_settings`
 * (`internal/infra/db/repos/conversations.go:288-296`,
 * `internal/api/v2/conversations/handler_test.go:735-749` confirms the real
 * body shape: `[{"id": "p1", "key": "val"}]`-style array). Sending an
 * object where the decoder expects an array fails JSON unmarshalling and
 * the handler responds `400 {"error": "invalid request body"}}` — this
 * call, ported byte-for-byte from the old app's wire contract, WILL 400
 * against the real Go backend as it stands today. This is a genuine,
 * previously-undiagnosed backend/frontend contract drift (the old pylon
 * backend evidently accepted the single-object "patch llm_settings for
 * every participant in this conversation" semantic the RTK mutation's name
 * and shape imply; the new Go handler instead implements a batch
 * per-participant update keyed by `participant_id`, a materially different
 * operation). Not "fixed" here by reshaping the body to the array form,
 * because the correct per-participant semantics this call site actually
 * needs (which participant(s), and whether an all-participants intent maps
 * to "every current participant's id" or something else) are a chat-feature
 * design decision this entity-layer port has no mandate to invent — a
 * future C2-C6 caller (or a backend fix restoring the old PATCH-object
 * semantics) must resolve this before this endpoint is wired to real UI.
 */
export async function updateParticipantLlmSettings(
  params: UpdateParticipantLlmSettingsParams,
): Promise<{ readonly ok: boolean }> {
  const { projectId, conversationId, llm_settings } = params;
  return fetchData<{ readonly ok: boolean }>(
    `/elitea_core/entity_settings/prompt_lib/${String(projectId)}/${conversationId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ llm_settings }),
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export function useUpdateParticipantLlmSettingsMutation(): UseMutationResult<
  { readonly ok: boolean },
  Error,
  UpdateParticipantLlmSettingsParams
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateParticipantLlmSettings,
    onSuccess: (_data, variables) =>
      void queryClient.invalidateQueries({
        queryKey: conversationDetailsQueryKey(String(variables.projectId), variables.conversationId),
      }),
  });
}
