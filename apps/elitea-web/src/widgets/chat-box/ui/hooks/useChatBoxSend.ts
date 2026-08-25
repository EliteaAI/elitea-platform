/**
 * useChatBoxSend — everything `sendQuestion` needs, assembled off widget state.
 *
 * Two jobs that only exist to serve one send:
 *
 *  1. The transport swap (issue #93): bind `features/chat-messages`'s
 *     `useChatStreamTransport` to this widget's live participant roster and
 *     the project/contract identity the Go agent-execution route requires.
 *  2. The two send-time adapters — create-the-conversation-first and
 *     upload-attachments-first — that `sendQuestion` calls before starting a
 *     run at all.
 *
 * A hook of its own rather than a block inside `ChatBox.tsx` because that file
 * and `ChatBox.helpers.ts` both sit exactly on the 400-line budget — the same
 * reason the other nine `useChatBox*` hooks exist.
 */
import { useCallback } from 'react';

import { useChatStreamTransport, type ChatMessage, type ChatStreamContext } from '@/features/chat-messages';
import { conversationApi } from '@/entities/conversation';
import { useAddParticipantMutation } from '@/entities/participant';
// Deep, still-legal import: `UploadedAttachment` is deliberately not on the
// entities barrel (its 20 slots are exactly spent — see that file's own note
// naming this exact path).
import type { useUploadAttachments } from '@/entities/conversation';

// Derived from the barrel-exported hook rather than deep-imported from its
// source file. `entities/conversation/index.ts` documents a 20-slot export cap
// and deliberately leaves the ~15 narrow param/result types out of it, telling
// consumers to import them from the concrete file — but that advice only holds
// WITHIN the slice. This widget is a different slice, so the deep path is a
// no-deep-slice-import-cross-slice violation (dependency-cruiser, "Layer +
// cycle gate"). Deriving keeps the single public entry point without spending
// two of the cap's remaining slots on types only this call site needs.
type UploadAttachments = ReturnType<typeof useUploadAttachments>['uploadAttachments'];
type UploadAttachmentsParams = Parameters<UploadAttachments>[0];
type UploadAttachmentsOutcome = Awaited<ReturnType<UploadAttachments>>;
import { getConfig } from '@/shared/config';
import { t } from '@/shared/i18n';

import { pickIdAndUuid } from '../ChatBox.helpers';
import { NO_STREAM_TRANSPORT, STREAM_STARTED, type StreamStartOutcome } from './useChatBoxHandlers.helpers';

/** The conversation-lifecycle and attachment-upload slices this hook adapts. */
interface SendDeps {
  readonly createConversation: (input: { name: string; isPrivate: boolean }) => Promise<{ readonly id?: string | number; readonly uuid?: string } | undefined>;
  readonly uploadAttachments: (input: UploadAttachmentsParams) => Promise<UploadAttachmentsOutcome>;
}

/**
 * The wire `entity_name` of a participant, or `''` when the value is not one.
 */
function participantEntityName(participant: unknown): string {
  const name = (participant as { readonly entity_name?: unknown } | null | undefined)?.entity_name;
  return typeof name === 'string' ? name : '';
}

/**
 * A participant an AGENT turn is addressed to.
 *
 * A pipeline is stored as `entity_name='application'` with
 * `entity_settings.agent_type='pipeline'`, so the singular `'application'` is
 * the value the turn resolver's SQL matches. `'pipeline'` is accepted as well
 * because `ChatParticipantType` defines it and a row could carry it.
 */
function isApplicationParticipant(participant: unknown): boolean {
  const name = participantEntityName(participant);
  return name === 'application' || name === 'pipeline';
}

/** A participant id the route can decode into its `int64` field, or `undefined`. */
function positiveParticipantId(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const numeric = Number(raw);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

/**
 * The participant this turn is addressed to.
 *
 * An explicit selection wins. With nothing selected, a conversation that holds
 * exactly ONE agent participant is addressing that agent. Resolving it here
 * keeps the turn off the ad-hoc contract. That contract's `participant_id: 0`
 * matches ANY `dummy` in the conversation. It would answer from a stray model
 * participant instead of the agent.
 */
export function resolveTargetParticipant(activeParticipant: unknown, participants: readonly unknown[] | undefined): unknown {
  if (activeParticipant !== undefined && activeParticipant !== null) return activeParticipant;
  const applications = (participants ?? []).filter(isApplicationParticipant);
  return applications.length === 1 ? applications[0] : activeParticipant;
}

/**
 * The agent-execution start body, or `undefined` when no body can satisfy the
 * chosen contract.
 *
 * The REST contract is NOT the socket payload: `chat_predict` carries a flat
 * `question`, while the route reads `payload.user_input`, its own
 * `interaction_uuid`, and `llm_settings` — and answers a flat
 * `400 Invalid agent execution request` when any of that is missing, naming
 * nothing. `question_id` and `interaction_uuid` must both be REAL uuids: the
 * repository parses them before querying and rejects the turn identically for
 * a malformed one as for an absent one.
 *
 * The two contracts are validated DIFFERENTLY, so one body shape cannot serve
 * both (`internal/api/v2/agentexecution/route.go`):
 *  - `agent.execute.application.v1` demands a POSITIVE `participant_id` and
 *    NO `llm_settings` key at all.
 *  - `agent.execute.adhoc.v1` demands an `llm_settings` OBJECT and accepts
 *    `participant_id: 0`.
 * A body that carries the other shape is answered `422
 * unsupported_agent_execution`, which names nothing.
 */
export function buildStartBody(params: {
  readonly conversationUuid: string;
  readonly projectId: string | undefined;
  readonly payload: Record<string, unknown>;
  readonly llmSettings: Readonly<Record<string, unknown>> | undefined;
  readonly modelName: string | undefined;
  readonly isApplicationTurn: boolean;
  readonly participantId: number | undefined;
}): Record<string, unknown> | undefined {
  const { payload } = params;
  const question = typeof payload['question'] === 'string' ? payload['question'] : '';
  // A NUMBER, not the string the socket payload carries: the route decodes
  // `project_id` into an integer field and rejects a string with the same flat
  // `400 Invalid agent execution request` it uses for every other malformed
  // body, naming nothing.
  const numericProjectID = Number(params.projectId);
  const base = {
    project_id: Number.isFinite(numericProjectID) ? numericProjectID : params.projectId,
    conversation_uuid: params.conversationUuid,
    question_id: payload['question_id'],
    interaction_uuid: crypto.randomUUID(),
    payload: { user_input: question, ...(payload['attachments'] ? { attachments: payload['attachments'] } : {}) },
  };
  if (params.isApplicationTurn) {
    if (params.participantId === undefined) return undefined;
    return { ...base, participant_id: params.participantId };
  }
  return {
    ...base,
    // 0 is the ad-hoc "no specific participant" value the backend smoke uses;
    // a missing key is rejected rather than defaulted.
    participant_id: params.participantId ?? 0,
    llm_settings: {
      ...params.llmSettings,
      ...(params.modelName !== undefined ? { model_name: params.modelName } : {}),
      stream: true,
    },
  };
}

/** The execution contract one turn takes, derived from the participant it addresses. */
export function resolveStartContract(target: unknown): string {
  return isApplicationParticipant(target) ? conversationApi.contracts.application : conversationApi.contracts.adhoc;
}

/**
 * The two participants an ad-hoc (plain model) turn resolves against.
 *
 * `ResolveCurrentAdhocTurn` joins on BOTH an `entity_name='user'` participant
 * whose `entity_meta.id` is the actor AND an `entity_name='dummy'` one carrying
 * the model — missing either resolves to no rows and the route answers
 * `422 unsupported_agent_execution`, which names neither (#292, and the same
 * opacity #288 is about). The backend smoke creates exactly this pair before
 * every turn it drives; the UI created neither, so a conversation opened from
 * the chat page could never run.
 *
 * NOTE the id: participants are addressed by the conversation's NUMERIC id
 * while the start route takes its UUID. Passing the wrong one is a bare 500.
 */
function adhocParticipants(input: {
  readonly userId: string | undefined;
  readonly modelName: string;
  readonly llmSettings: Readonly<Record<string, unknown>> | undefined;
}): { readonly entity_name: string; readonly entity_meta?: Record<string, unknown>; readonly entity_settings?: Record<string, unknown> }[] {
  const llmSettings = { ...input.llmSettings, model_name: input.modelName, stream: true };
  return [
    ...(input.userId !== undefined ? [{ entity_name: 'user', entity_meta: { id: Number(input.userId) } }] : []),
    { entity_name: 'dummy', entity_meta: { name: input.modelName }, entity_settings: { llm_settings: llmSettings } },
  ];
}

/** @public Params for `useChatBoxSend`. */
export interface UseChatBoxSendParams {
  readonly deps: SendDeps;
  /** Model settings the composer resolved; forwarded as the turn's `llm_settings`. */
  readonly llmSettings?: Readonly<Record<string, unknown>> | undefined;
  /**
   * The selected model. Passed as the object rather than a pre-read name so the
   * optional chain lives here — reading it at the ChatBox call site pushed that
   * component over its complexity budget.
   */
  readonly model?: { readonly name?: string | undefined } | null | undefined;
  readonly setChatHistory: (updater: (prev: readonly ChatMessage[]) => readonly ChatMessage[]) => void;
  /**
   * The conversation on screen. The transport closes a stream whose owning
   * conversation is no longer this one and drops its frames — without it, a
   * run started in conversation A keeps writing into whichever conversation
   * the (never-unmounted) ChatBox switches to (#328).
   */
  readonly conversationUuid?: string | undefined;
  readonly projectId: string | number | undefined;
  readonly projectIdString: string | undefined;
  /**
   * The agents/test-panel host, which seeds no ad-hoc participants.
   *
   * It does NOT pick the execution contract any more: the sole `<ChatBox>`
   * call site never sets it, so the contract has to come from the participant
   * the turn addresses (`resolveStartContract`).
   */
  readonly isAgentsPage?: boolean | undefined;
  /** The signed-in user, for the ad-hoc turn's `user` participant. */
  readonly userId?: string | undefined;
  readonly activeParticipant?: unknown;
  readonly participants?: readonly unknown[] | undefined;
  readonly userName?: string | undefined;
  readonly userAvatar?: string | undefined;
}

/** @public */
export interface UseChatBoxSendResult {
  /**
   * Start the run over REST and subscribe to its stream. `started` ⇒ this
   * transport owns the run and `chat_predict` must NOT also be emitted.
   */
  readonly startStreamedExecution: (params: {
    readonly conversationUuid: string;
    readonly payload: Record<string, unknown>;
  }) => Promise<StreamStartOutcome>;
  /**
   * Resume a PAUSED run over REST and re-subscribe to its stream.
   *
   * `started` ⇒ the route accepted the resume and `chat_continue_predict`
   * must NOT also be emitted; a second resume runs the agent twice.
   */
  readonly continueStreamedExecution: (params: {
    readonly conversationUuid: string;
    readonly body: Record<string, unknown>;
  }) => Promise<StreamStartOutcome>;
  readonly isStreaming: boolean;
  /**
   * The user pressed Stop: cancel the run server-side and close its stream.
   * A no-op when this transport does not own the current run, so it is safe to
   * call alongside the socket-era `stopStreaming`.
   */
  readonly stopStreamedExecution: () => void;
  readonly createConversationForSend: (question: string) => Promise<{ readonly id?: string | number; readonly uuid?: string } | undefined>;
  readonly uploadAttachmentsForSend: (
    conversationId: string | number,
    files: readonly File[],
  ) => Promise<{ readonly success: boolean; readonly uploaded: UploadAttachmentsOutcome['uploaded'] }>;
}

/**
 * The identity the reducer needs for messages it has to create.
 *
 * The baseline read all of this off refs (`participantsRef`,
 * `activeParticipantRef`). A pure reducer takes it as a value, so this is
 * where the widget's live participant state crosses that boundary.
 */
function buildChatStreamContext(params: UseChatBoxSendParams): ChatStreamContext {
  const participantId = (params.activeParticipant as { id?: string | number } | undefined)?.id;
  return {
    ...(participantId !== undefined ? { participantId: String(participantId) } : {}),
    ...(params.userName !== undefined ? { name: params.userName } : {}),
    ...(params.userAvatar !== undefined ? { avatar: params.userAvatar } : {}),
    ...(params.participants !== undefined
      ? { participants: params.participants as ChatStreamContext['participants'] }
      : {}),
  };
}

export function useChatBoxSend(params: UseChatBoxSendParams): UseChatBoxSendResult {
  const { setChatHistory, projectId, projectIdString, isAgentsPage } = params;
  const transport = useChatStreamTransport({
    setChatHistory,
    ...(params.conversationUuid !== undefined ? { conversationUuid: params.conversationUuid } : {}),
    context: buildChatStreamContext(params),
  });
  const { start, resume } = transport;

  const startStreamedExecution = useCallback(
    async ({ conversationUuid, payload }: { readonly conversationUuid: string; readonly payload: Record<string, unknown> }): Promise<StreamStartOutcome> => {
      // No project ⇒ no route to POST to. Reporting no-transport keeps the
      // socket fallback rather than silently sending nothing.
      if (projectId === undefined) return NO_STREAM_TRANSPORT;
      // The contract comes from the PARTICIPANT this turn addresses, never
      // from a page flag. The sole `<ChatBox>` call site passes no
      // `isAgentsPage`. Deriving it from that flag therefore sent every turn
      // — including one addressed to an agent — as `agent.execute.adhoc.v1`.
      // That resolver joins on `entity_name='dummy'` and answers 422 for an
      // agent participant.
      const target = resolveTargetParticipant(params.activeParticipant, params.participants);
      const isApplicationTurn = resolveStartContract(target) === conversationApi.contracts.application;
      const body = buildStartBody({
        conversationUuid,
        projectId: projectIdString,
        payload,
        llmSettings: params.llmSettings,
        modelName: params.model?.name,
        isApplicationTurn,
        participantId: positiveParticipantId(payload['participant_id']) ?? positiveParticipantId((target as { readonly id?: unknown } | null | undefined)?.id),
      });
      // No body can satisfy this contract (an agent turn with no addressable
      // participant). The socket fallback takes it rather than a POST that is
      // certain to be refused.
      if (body === undefined) return NO_STREAM_TRANSPORT;
      const started = await start({ projectId, conversationUuid, contract: resolveStartContract(target), body });
      return started ? STREAM_STARTED : NO_STREAM_TRANSPORT;
    },
    [start, projectId, projectIdString, params.llmSettings, params.model, params.activeParticipant, params.participants],
  );

  const continueStreamedExecution = useCallback(
    async ({ conversationUuid, body }: { readonly conversationUuid: string; readonly body: Record<string, unknown> }): Promise<StreamStartOutcome> => {
      // No project ⇒ no route to POST to. Reporting no-transport keeps the
      // socket fallback rather than silently sending nothing.
      if (projectId === undefined) return NO_STREAM_TRANSPORT;
      const resumed = await resume({
        projectId,
        conversationUuid,
        contract: conversationApi.contracts.continueHitl,
        body,
      });
      return resumed ? STREAM_STARTED : NO_STREAM_TRANSPORT;
    },
    [resume, projectId],
  );

  const { deps } = params;
  const { mutateAsync: addParticipants } = useAddParticipantMutation();
  const createConversationForSend = useCallback(
    async (question: string) => {
      const created = await deps.createConversation({
        name: question.slice(0, 50) || t('widgets.chatBox.defaultConversationName', 'New Chat'),
        isPrivate: true,
      });
      if (!created) return undefined;

      // A plain model chat has to carry its own participants; an agent
      // conversation already has the agent as one, so this is scoped to the
      // ad-hoc path and to a chat that actually has a model to name.
      const modelName = params.model?.name;
      if (!isAgentsPage && !modelName) {
        // NOT silent, and not a refusal either. With no model there is nothing
        // to put in the `dummy` participant. Every REST turn this
        // conversation ever receives therefore resolves to no rows. The route
        // answers `422 unsupported_agent_execution`. The conversation is still
        // created because the socket path does not need that participant, so
        // refusing here would break a deployment whose socket works.
        //
        // `model` is null exactly when the project has no model catalogue or
        // the catalogue call failed. The user has to be told about that state.
        console.warn('[useChatBoxSend] no model is selected: created an ad-hoc conversation with no `dummy` participant, so its REST turns cannot resolve');
      }
      if (!isAgentsPage && modelName && created.id !== undefined && projectId !== undefined) {
        try {
          await addParticipants({
            projectId,
            conversationId: String(created.id),
            participants: adhocParticipants({ userId: params.userId, modelName, llmSettings: params.llmSettings }),
          });
        } catch (error) {
          // Not fatal to the send: the turn will fail its own admission with a
          // message, which is more useful than swallowing the question here.
          console.warn('[useChatBoxSend] could not add ad-hoc participants:', error);
        }
      }
      return pickIdAndUuid(created);
    },
    [deps, isAgentsPage, projectId, params.model, params.userId, params.llmSettings, addParticipants],
  );

  const uploadAttachmentsForSend = useCallback(
    async (conversationId: string | number, files: readonly File[]) => {
      const cfg = getConfig();
      if (cfg.status !== 'ok' || projectId === undefined) return { success: true, uploaded: [] };
      const outcome = await deps.uploadAttachments({
        baseUrl: cfg.config.vite_server_url,
        projectId: String(projectId),
        conversationId: String(conversationId),
        attachments: files,
      });
      return { success: outcome.success, uploaded: outcome.uploaded };
    },
    [deps, projectId],
  );

  return {
    startStreamedExecution,
    continueStreamedExecution,
    isStreaming: transport.isStreaming,
    stopStreamedExecution: transport.stop,
    createConversationForSend,
    uploadAttachmentsForSend,
  };
}
