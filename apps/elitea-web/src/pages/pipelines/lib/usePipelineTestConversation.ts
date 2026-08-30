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
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import { conversationApi } from '@/entities/conversation';
import { useAddParticipantMutation } from '@/entities/participant';
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
  /** Create the conversation if it does not exist yet. Idempotent, and a no-op while the identity is incomplete. */
  readonly ensure: () => void;
}

interface BootstrapState {
  readonly conversation: ActiveConversation;
  readonly activeParticipant: unknown;
  readonly isCreating: boolean;
  readonly hasFailed: boolean;
}

const IDLE: BootstrapState = { conversation: undefined, activeParticipant: undefined, isCreating: false, hasFailed: false };

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
  readonly entity_settings?: Readonly<Record<string, unknown>>;
}

/** Every field the participants below need, or `undefined` when the page has not resolved them all yet. */
function completeIdentity(identity: PipelineTestChatIdentity): ResolvedIdentity | undefined {
  const { projectId, applicationId, pipelineName, versionId, agentType, userId } = identity;
  if (projectId === undefined || applicationId === undefined || versionId === undefined || userId === undefined) return undefined;
  return { projectId, applicationId, pipelineName: pipelineName ?? '', versionId, agentType: agentType ?? 'pipeline', userId };
}

/** The two rows a pipeline conversation cannot answer without — see `ChatWithPipelineButton.tsx` for why each is load-bearing. */
function participantsFor(identity: ResolvedIdentity): readonly ParticipantRow[] {
  return [
    // FIRST, and as a NUMBER: the resolver's author join compares `entity_meta->>'id'` to the acting user id.
    { entity_name: 'user', entity_meta: { id: Number(identity.userId) } },
    {
      entity_name: 'application',
      entity_meta: { id: identity.applicationId, name: identity.pipelineName, project_id: identity.projectId },
      entity_settings: { version_id: identity.versionId, agent_type: identity.agentType, variables: [], icon_meta: {} },
    },
  ];
}

export function usePipelineTestConversation(identity: PipelineTestChatIdentity): UsePipelineTestConversationResult {
  const { mutateAsync: createConversation } = conversationApi.useCreate();
  const { mutateAsync: addParticipants } = useAddParticipantMutation();
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
        setState({
          conversation: {
            id: detail.id,
            ...(detail.uuid !== undefined ? { uuid: detail.uuid } : {}),
            name: detail.name,
            participants,
            message_groups: [],
          },
          activeParticipant: participants.find((row) => row.entity_name === 'application'),
          isCreating: false,
          hasFailed: false,
        });
      } catch {
        // Left ARMED for a retry: a failed bootstrap is usually a transient
        // network/permission error, and a pane that could never try again
        // would need a page reload to recover.
        startedRef.current = false;
        setState({ ...IDLE, hasFailed: true });
      }
    })();
  }, [createConversation, addParticipants]);

  return useMemo(
    () => ({
      conversation: state.conversation,
      activeParticipant: state.activeParticipant,
      isCreating: state.isCreating,
      hasFailed: state.hasFailed,
      ensure,
    }),
    [state, ensure],
  );
}
