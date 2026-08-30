/**
 * The conversation the pipeline editor's own test chat talks through.
 *
 * `pages/pipelines/ui/ChatWithPipelineButton.tsx` already performs these
 * exact three steps for the "Chat" action that navigates AWAY to `/chat`:
 * create a private conversation, attach the signed-in USER and the pipeline
 * as participants, then talk. This hook is the same three steps performed
 * IN PLACE, so the editor's right-hand pane is a real chat instead of the
 * disclosed gap it used to render — read that file's own doc comment for the
 * full participant mapping (`entity_name: 'application'` with
 * `entity_settings.agent_type: 'pipeline'`, the load-bearing `version_id`,
 * and why the `user` row is the client's to add).
 *
 * **WHY THE CONVERSATION IS CREATED UP FRONT AND NOT ON THE FIRST SEND.**
 * `ChatBox` does have a lazy path (`useChatBoxSend`'s
 * `createConversationForSend`), but the conversation it creates carries only
 * the AD-HOC model participants, and only when the host is not an
 * "agents page" — a pipeline turn needs a persisted `application`
 * participant whose numeric id the start body names
 * (`buildStartBody`: an application turn with no `participant_id` is not
 * sent at all). A participant this hook invented client-side has no id, so
 * the row has to exist server-side before the first send can be admitted.
 *
 * **WHAT KEEPS IT FROM CREATING ONE PER PAGE VIEW.** `ensure()` is called
 * from the pane's first real interaction (pointer-down or focus inside the
 * chat column), not from an effect on mount, and it is idempotent: opening
 * the editor to look at the graph creates nothing. The `startedRef` guard —
 * not `isCreating` state — is what makes it idempotent, because two events
 * in the same tick both see the pre-render state.
 *
 * **AND WHAT KEEPS IT FROM CREATING ONE PER PANE MOUNT.** `startedRef` is
 * per-mount, so it alone would mint a fresh conversation every time the pane
 * unmounts and comes back — switching editor tabs, or leaving the pipeline
 * and returning. `LIVE_TEST_CONVERSATIONS` below is a module-scope map keyed
 * by `projectId:applicationId` that survives those remounts, so the pane
 * re-attaches to the conversation it already made instead of leaving a trail
 * of one-message private conversations in the user's sidebar.
 *
 * **DISCLOSED — A FULL BROWSER RELOAD STILL STARTS A FRESH CONVERSATION.**
 * That map is module scope, not storage: a reload (or a hard navigation, or
 * a new tab) empties it, and the next interaction with the pane creates a
 * NEW test conversation. What the user loses is concrete: the transcript
 * they had been building is not reattached — the pane comes back empty, and
 * the previous conversation is reachable only through the `/chat` sidebar,
 * where it sits as another private "<pipeline name>" entry. Nothing is
 * deleted, and nothing is silently rerouted; the editor simply has no
 * "resume my last test chat" concept, because it has no list of past test
 * conversations to resume FROM. Persisting the id (session storage, or a
 * server-side "latest test conversation for this application" read) is the
 * fix, and it is deliberately not attempted here: choosing which
 * conversation a returning user resumes is a product decision, and guessing
 * wrong reattaches someone to a transcript they thought they had left.
 * The map is also never evicted — it holds one small record per pipeline
 * visited in this page's lifetime, which is bounded by the same navigation
 * that would have created the conversations anyway.
 *
 * **THE VERSION THE CHAT RUNS IS SERVER-SIDE STATE, SO SWITCHING VERSIONS IS
 * A WRITE.** The `application` participant pins `entity_settings.version_id`,
 * and the worker resolves the graph from that STORED row — not from anything
 * the client sends per turn. So a user who switches the editor to another
 * version while a test conversation is open would keep running the old
 * graph, reading the new one on screen, with nothing to see. `syncVersion`
 * below writes the new version onto the persisted row when the identity's
 * `versionId` moves. Two things about how:
 *
 *  - It goes through the participant-settings MUTATION (`updateParticipantSettings`,
 *    reached via `useUpdateParticipantSettingsMutation`), never through a
 *    cached query read. A `fetchQuery`-shaped call would be worse than
 *    useless here: with the app's 30s `staleTime`, switching v7 -> v9 -> v7
 *    inside that window replays the v7 entry out of cache, resolves
 *    successfully, and sends NOTHING — the row would still say v9 while this
 *    hook reported the switch as done.
 *  - It does NOT touch `conversation.participants`. `ChatBox`'s
 *    `useChatBoxData` re-seeds its live transcript (`conversationForSync`)
 *    from `messageGroups`/`participants` whenever that participants array
 *    changes identity, and this hook passes `message_groups: []` — so
 *    "helpfully" writing the new `version_id` into the client row would wipe
 *    every message on screen at the exact moment the user switched versions.
 *    The stored row is the only copy that matters; the client one is left as
 *    it was, deliberately.
 *
 * The PUT REPLACES `entity_settings` wholesale (`ConversationsRepo.
 * UpdateEntitySettings`: `SET entity_settings = $1`), so the body is the
 * last known-good settings object with `version_id` overridden, not a
 * `{version_id}` patch — sending the patch alone would drop `agent_type` and
 * leave the row unroutable. A failed switch is surfaced (`hasStaleVersion`)
 * rather than retried forever: one attempt per version, so a permission
 * error does not become a write loop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { conversationApi } from '@/entities/conversation';
import { useAddParticipantMutation, useUpdateParticipantSettingsMutation } from '@/entities/participant';
import { t } from '@/shared/i18n';
import type { ChatBoxProps } from '@/widgets/chat-box';

/** `ChatBox`'s own active-conversation shape. Derived rather than imported by name: `widgets/chat-box`'s barrel exports the props type, not `ChatBoxActiveConversation`. */
type ActiveConversation = NonNullable<ChatBoxProps['conversation']>['active'];

/** `ChatBox` truncates a conversation name to 50 characters; match it so the sidebar entry reads the same everywhere (`ChatWithPipelineButton.tsx` pins the same number). */
const MAX_CONVERSATION_NAME = 50;

/** Everything one bootstrap needs, gathered into ONE object so the callback below closes over a single ref-stable value (the §3.5 hook-deps budget is 8). */
export interface PipelineTestChatIdentity {
  readonly projectId: string | undefined;
  /** The pipeline's application id, as the route carries it. */
  readonly applicationId: string | undefined;
  readonly pipelineName: string | undefined;
  /** The version the chat runs — the participant pins it, and the resolver joins on it. */
  readonly versionId: string | undefined;
  readonly agentType: string | undefined;
  /** The signed-in user, because the USER participant is the client's to add. */
  readonly userId: string | undefined;
}

export interface UsePipelineTestConversationResult {
  /** The conversation `ChatBox` renders, or `undefined` before the first interaction. */
  readonly conversation: ActiveConversation;
  /** The persisted pipeline participant this conversation's turns address — `ChatBox`'s `participant.active`. */
  readonly activeParticipant: unknown;
  readonly isCreating: boolean;
  /** The bootstrap failed. The pane says so rather than leaving a composer that silently cannot send. */
  readonly hasFailed: boolean;
  /**
   * The editor moved to another version and writing it onto the participant
   * failed, so turns still run the version named here. Surfaced because the
   * alternative is a chat that answers from a graph the screen is not showing.
   */
  readonly staleVersionId: string | undefined;
  /** Create the conversation if it does not exist yet. Idempotent, and a no-op while the identity is incomplete. */
  readonly ensure: () => void;
}

/** One participant's `entity_settings` as this hook maintains them. */
type ParticipantSettings = Readonly<Record<string, unknown>>;

interface BootstrapState {
  readonly conversation: ActiveConversation;
  readonly activeParticipant: unknown;
  /** The persisted `application` participant's id — the settings PUT addresses it. */
  readonly participantId: string | undefined;
  /** The version the STORED row currently names, as far as this hook knows. */
  readonly syncedVersionId: string | undefined;
  /** The last settings object written to (or read from) that row — the PUT replaces wholesale, so the next write starts from this. */
  readonly settings: ParticipantSettings | undefined;
  readonly isCreating: boolean;
  readonly hasFailed: boolean;
  /** Set when a version write failed; cleared by the next one that succeeds. */
  readonly hasStaleVersion: boolean;
}

const IDLE: BootstrapState = {
  conversation: undefined,
  activeParticipant: undefined,
  participantId: undefined,
  syncedVersionId: undefined,
  settings: undefined,
  isCreating: false,
  hasFailed: false,
  hasStaleVersion: false,
};

/**
 * The same identity with every field resolved. Spelled out rather than
 * written `Required<PipelineTestChatIdentity>`: under
 * `exactOptionalPropertyTypes` the fields are `T | undefined` by DECLARATION,
 * not by optionality, so `Required<>` would leave the `| undefined` in place.
 */
interface ResolvedIdentity {
  readonly projectId: string;
  readonly applicationId: string;
  readonly pipelineName: string;
  readonly versionId: string;
  readonly agentType: string;
  readonly userId: string;
}

/** One participant row as the add endpoint reads it (`entity_name`/`entity_meta`/`entity_settings` — `entities/participant`'s own `ParticipantAddInput`, which that slice deliberately keeps off its barrel). */
interface ParticipantRow {
  readonly entity_name: string;
  readonly entity_meta?: Readonly<Record<string, unknown>>;
  readonly entity_settings?: ParticipantSettings;
}

/** The subset of a read-back participant this hook reads off the conversation detail. */
interface StoredParticipant {
  readonly id?: string;
  readonly entity_name?: string;
  readonly entity_settings?: ParticipantSettings;
}

/** Reused across mounts of the pane — see the module doc's "one per pane mount" and reload-disclosure paragraphs. */
interface LiveTestConversation {
  readonly conversation: ActiveConversation;
  readonly activeParticipant: unknown;
  readonly participantId: string | undefined;
  readonly syncedVersionId: string;
  readonly settings: ParticipantSettings;
}

const LIVE_TEST_CONVERSATIONS = new Map<string, LiveTestConversation>();

/** Keyed by pipeline, not by version: switching versions rewrites the participant rather than starting a second conversation. */
function conversationKey(identity: ResolvedIdentity): string {
  return `${identity.projectId}:${identity.applicationId}`;
}

/** Test-only: the map is module scope, so a suite that creates conversations must be able to start from empty. */
export function resetPipelineTestConversationsForTests(): void {
  LIVE_TEST_CONVERSATIONS.clear();
}

/** Every field the participants below need, or `undefined` when the page has not resolved them all yet. */
function completeIdentity(identity: PipelineTestChatIdentity): ResolvedIdentity | undefined {
  const { projectId, applicationId, pipelineName, versionId, agentType, userId } = identity;
  if (projectId === undefined || applicationId === undefined || versionId === undefined || userId === undefined) return undefined;
  return { projectId, applicationId, pipelineName: pipelineName ?? '', versionId, agentType: agentType ?? 'pipeline', userId };
}

/** The `application` participant's settings — `version_id` is what the worker resolves the graph from, `agent_type` is what routes it to the graph assembler. */
function applicationSettings(identity: ResolvedIdentity): ParticipantSettings {
  return { version_id: identity.versionId, agent_type: identity.agentType, variables: [], icon_meta: {} };
}

/** The two rows a pipeline conversation cannot answer without — see `ChatWithPipelineButton.tsx` for why each is load-bearing. */
function participantsFor(identity: ResolvedIdentity): readonly ParticipantRow[] {
  return [
    // FIRST, and as a NUMBER: the resolver's author join compares `entity_meta->>'id'` to the acting user id.
    { entity_name: 'user', entity_meta: { id: Number(identity.userId) } },
    {
      entity_name: 'application',
      entity_meta: { id: identity.applicationId, name: identity.pipelineName, project_id: identity.projectId },
      entity_settings: applicationSettings(identity),
    },
  ];
}

export function usePipelineTestConversation(identity: PipelineTestChatIdentity): UsePipelineTestConversationResult {
  const { mutateAsync: createConversation } = conversationApi.useCreate();
  const { mutateAsync: addParticipants } = useAddParticipantMutation();
  // The PUT replaces `entity_settings` wholesale, hence the local name. Taken
  // as a MUTATION on purpose — see the module doc on why a cached query read
  // would report a v7 -> v9 -> v7 switch as done without sending anything.
  const { mutateAsync: replaceParticipantSettings } = useUpdateParticipantSettingsMutation();
  const [state, setState] = useState<BootstrapState>(IDLE);
  const startedRef = useRef(false);

  const resolved = completeIdentity(identity);
  // Read through a ref so `ensure` keeps ONE identity for the pane's whole
  // life: it must not become a new callback every time the version query
  // refetches, or an in-flight bootstrap would be started twice.
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  const ensure = useCallback(() => {
    if (startedRef.current) return;
    const input = resolvedRef.current;
    if (input === undefined) return;
    startedRef.current = true;

    // Re-attach rather than create: this pane has already made a test
    // conversation for this pipeline earlier in the page's life.
    const live = LIVE_TEST_CONVERSATIONS.get(conversationKey(input));
    if (live !== undefined) {
      setState({ ...IDLE, ...live });
      return;
    }

    setState({ ...IDLE, isCreating: true });

    void (async () => {
      try {
        const created = await createConversation({
          projectId: input.projectId,
          name: input.pipelineName.slice(0, MAX_CONVERSATION_NAME) || t('pages.pipelines.testChat.defaultName', 'Pipeline test chat'),
          is_private: true,
        });
        const conversationId = String(created.id);
        await addParticipants({ projectId: input.projectId, conversationId, participants: participantsFor(input) });
        // Read the participants BACK rather than trusting the add response:
        // the start body names the participant by its persisted numeric id,
        // and the conversation detail is the shape `ChatBox` already consumes
        // on `/chat` (raw wire rows, `entity_name` and all).
        const detail = await conversationApi.details({ projectId: input.projectId, id: conversationId });
        const participants = [...(detail.participants ?? [])];
        const application: StoredParticipant | undefined = participants.find((row) => row.entity_name === 'application');
        const record: LiveTestConversation = {
          conversation: {
            id: detail.id,
            ...(detail.uuid !== undefined ? { uuid: detail.uuid } : {}),
            name: detail.name,
            participants,
            message_groups: [],
          },
          activeParticipant: application,
          participantId: application?.id,
          // What the row NOW holds. Read back rather than assumed, so a
          // server-side rewrite (`UpdateEntitySettings` strips `llm_settings`
          // for a non-published agent's `application`) is what the next
          // wholesale PUT starts from.
          syncedVersionId: input.versionId,
          settings: application?.entity_settings ?? applicationSettings(input),
        };
        LIVE_TEST_CONVERSATIONS.set(conversationKey(input), record);
        setState({ ...IDLE, ...record });
      } catch {
        // Left ARMED for a retry: a failed bootstrap is usually a transient
        // network/permission error, and a pane that could never try again
        // would need a page reload to recover.
        startedRef.current = false;
        setState({ ...IDLE, hasFailed: true });
      }
    })();
  }, [createConversation, addParticipants]);

  const { participantId, syncedVersionId, settings } = state;
  const conversationId = state.conversation?.id;
  const liveVersionId = resolved?.versionId;
  // One attempt per version: a switch that fails on permissions must show as
  // stale, not become a write loop against the same row.
  const attemptedVersionRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const input = resolvedRef.current;
    if (input === undefined || conversationId === undefined || participantId === undefined) return;
    if (syncedVersionId === undefined || settings === undefined) return;
    if (input.versionId === syncedVersionId) return;
    if (attemptedVersionRef.current === input.versionId) return;
    attemptedVersionRef.current = input.versionId;

    void (async () => {
      const next: ParticipantSettings = { ...settings, version_id: input.versionId, agent_type: input.agentType };
      try {
        // The echoed body, not the request: the handler strips `llm_settings`
        // for a non-published agent's `application`, and the next wholesale
        // PUT has to start from what the row actually holds.
        const stored = await replaceParticipantSettings({
          projectId: input.projectId,
          conversationId: String(conversationId),
          participantId,
          settings: next,
        });
        const record = LIVE_TEST_CONVERSATIONS.get(conversationKey(input));
        if (record !== undefined) {
          LIVE_TEST_CONVERSATIONS.set(conversationKey(input), { ...record, syncedVersionId: input.versionId, settings: stored });
        }
        // `conversation` is carried through UNCHANGED — writing the new
        // `version_id` into the client participant row would change that
        // array's identity and make `useChatBoxData` re-seed its transcript
        // from this hook's empty `message_groups`, wiping the chat on screen.
        setState((prev) => ({ ...prev, syncedVersionId: input.versionId, settings: stored, hasStaleVersion: false }));
      } catch {
        setState((prev) => ({ ...prev, hasStaleVersion: true }));
      }
    })();
  }, [liveVersionId, conversationId, participantId, syncedVersionId, settings, replaceParticipantSettings]);

  return useMemo(
    () => ({
      conversation: state.conversation,
      activeParticipant: state.activeParticipant,
      isCreating: state.isCreating,
      hasFailed: state.hasFailed,
      staleVersionId: state.hasStaleVersion ? state.syncedVersionId : undefined,
      ensure,
    }),
    [state, ensure],
  );
}
