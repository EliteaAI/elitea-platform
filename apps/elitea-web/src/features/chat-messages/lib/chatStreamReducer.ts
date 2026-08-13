/**
 * lib/chatStreamReducer.ts — the chat streaming reducer (issue #93, Surface B).
 *
 * PORT STATUS — first slice. The baseline reducer is
 * `EliteaUI/src/components/Chat/hooks.js:391-1581`: 1,191 lines, 34 switch
 * cases. This module ports the 14 that carry a plain agent turn from "sent" to
 * "answered", which is the sequence a live stack actually emits:
 *
 *   agent_start → agent_on_transitional_edge → agent_llm_start
 *     → agent_llm_chunk* → agent_llm_end → agent_response
 *     → partial_message → full_message → pipeline_finish
 *
 * NOT YET PORTED, each its own slice, and each currently a no-op that leaves
 * state untouched rather than a silent content drop:
 *
 *   tool nodes        agent_tool_start/end/error, agent_on_function_tool_node,
 *                     agent_on_tool_node, agent_on_*_edge
 *   thinking          agent_thinking_step, agent_thinking_step_update, and the
 *                     `thinking_steps` fan-out AgentLlmEnd performs in the
 *                     baseline (hooks.js:~700+)
 *   interrupts        agent_hitl_interrupt, agent_requires_confirmation,
 *                     mcp_authorization_required
 *   swarm             swarm_child_message, agent_swarm_agent_start,
 *                     agent_swarm_agent_response, agent_swarm_handoff
 *   summaries         chat_predict_summary_started/finished
 *   echo              chat_user_message
 *
 * The omitted cases are exactly the ones that build `toolActions`, so this
 * slice deliberately does not touch that field: a half-built tool timeline is
 * worse than none, and `useSyncChatMessage`'s merge already preserves locally
 * added `toolActions` when the persisted group arrives.
 *
 * SHAPE DEVIATION from the baseline, applied throughout: the baseline MUTATES a
 * message object and calls `setChatHistory` for its side effects, reading refs
 * for participants and the active participant. `ChatMessage` here is deeply
 * readonly, so this is a pure `(state, frame) => state` reducer — no refs, no
 * hooks, no I/O. That is what makes it testable against recorded frames without
 * a socket, a server, or a React tree, and it is why the port is worth doing
 * before the transport swap rather than after.
 */
import { convertJsonToString } from '@/shared/lib/json';
import { ROLES } from '@/shared/lib/enums';

import type { ChatMessage } from './convertMessagesToChatHistory';
import { SocketMessageType, type ChatStreamFrame } from './chatStreamFrame';

/** Caller-supplied identity for messages this reducer has to create. */
export interface ChatStreamContext {
  /** Participant the answer is attributed to, when the frame does not say. */
  readonly participantId?: string | undefined;
  /** Display name for a newly created assistant message. */
  readonly name?: string | undefined;
  /** Avatar for a newly created assistant message. */
  readonly avatar?: string | undefined;
  /** Injectable clock so tests do not depend on wall time. */
  readonly now?: () => string;
}

function nowIso(context: ChatStreamContext): string {
  return context.now ? context.now() : new Date().toISOString();
}

/**
 * Resolve the assistant message a frame belongs to.
 *
 * By `message_id` first, then by `questionId` — the baseline's `getMessage`
 * does the same (hooks.js:391-404) because the two identifiers arrive in
 * different frames: `start_task` names the question it answers before the
 * assistant message has an id of its own.
 */
function findTarget(history: readonly ChatMessage[], frame: ChatStreamFrame): number {
  const messageId = frame.message_id;
  if (messageId) {
    const byId = history.findIndex((message) => message.id === messageId);
    if (byId !== -1) return byId;
  }
  const questionId = frame.question_id;
  if (questionId) {
    return history.findIndex(
      (message) => message.questionId === questionId && message.role === ROLES.Assistant,
    );
  }
  return -1;
}

/** A fresh assistant message for a frame that names one we have never seen. */
function createAssistantMessage(frame: ChatStreamFrame, context: ChatStreamContext): ChatMessage {
  return {
    id: frame.message_id ?? crypto.randomUUID(),
    role: ROLES.Assistant,
    name: context.name ?? '',
    content: '',
    createdAt: nowIso(context),
    isStreaming: true,
    isLoading: true,
    ...(frame.question_id !== undefined ? { questionId: frame.question_id } : {}),
    ...(context.participantId !== undefined ? { participantId: context.participantId } : {}),
    ...(context.avatar !== undefined ? { avatar: context.avatar } : {}),
  };
}

function replaceAt(
  history: readonly ChatMessage[],
  index: number,
  update: Partial<ChatMessage>,
): readonly ChatMessage[] {
  return history.map((message, position) => (position === index ? { ...message, ...update } : message));
}

/** The frame's text, in the baseline's two flavours: fenced for whole responses, raw for chunks. */
function frameText(frame: ChatStreamFrame, inBlock: boolean): string {
  if (frame.content === undefined || frame.content === null) return '';
  return convertJsonToString(frame.content, inBlock);
}

/**
 * A turn is finished when the model reports why it stopped. The baseline gates
 * on `response_metadata.finish_reason` for exactly this
 * (hooks.js AgentResponse), rather than on the frame type, because a response
 * frame also arrives mid-turn for intermediate agent output.
 */
function isFinalResponse(frame: ChatStreamFrame): boolean {
  return Boolean(frame.response_metadata?.finish_reason);
}

function threadIdOf(frame: ChatStreamFrame): string | undefined {
  const metadata = frame.response_metadata;
  const nested = metadata?.metadata?.thread_id;
  return typeof nested === 'string' ? nested : typeof metadata?.thread_id === 'string' ? metadata.thread_id : undefined;
}

/**
 * Apply one streaming frame.
 *
 * Returns the SAME array reference when the frame changes nothing, so a caller
 * passing this to `setState` does not re-render on frames this slice ignores.
 */
export function applyChatStreamFrame(
  history: readonly ChatMessage[],
  frame: ChatStreamFrame,
  context: ChatStreamContext = {},
): readonly ChatMessage[] {
  const type = frame.type;
  if (!type) return history;

  const index = findTarget(history, frame);

  switch (type) {
    // The turn begins. The baseline resets content here unless it is resuming a
    // continuation, so a regenerate does not append to the previous answer.
    case SocketMessageType.StartTask:
    case SocketMessageType.AgentStart: {
      if (index === -1) return [...history, createAssistantMessage(frame, context)];
      return replaceAt(history, index, {
        content: '',
        isStreaming: true,
        isLoading: true,
        references: [],
        exception: undefined,
        ...(frame.question_id !== undefined ? { questionId: frame.question_id } : {}),
      });
    }

    // The model started producing. No content yet; this only flips the spinner
    // for a message that may not exist until the first chunk arrives.
    case SocketMessageType.AgentLlmStart: {
      if (index === -1) return [...history, createAssistantMessage(frame, context)];
      return replaceAt(history, index, { isStreaming: true, isLoading: true });
    }

    // The three chunk flavours are one behaviour: append the delta.
    case SocketMessageType.AgentLlmChunk:
    case SocketMessageType.Chunk:
    case SocketMessageType.AIMessageChunk: {
      const delta = frameText(frame, false);
      if (!delta) return history;
      if (index === -1) {
        const created = createAssistantMessage(frame, context);
        return [...history, { ...created, content: delta }];
      }
      const current = history[index];
      if (!current) return history;
      return replaceAt(history, index, {
        content: current.content + delta,
        isStreaming: true,
        isLoading: true,
      });
    }

    // The model finished emitting tokens. Streaming stops; the turn is not
    // necessarily over (agent_response and pipeline_finish still follow).
    case SocketMessageType.AgentLlmEnd: {
      if (index === -1) return history;
      return replaceAt(history, index, { isLoading: false });
    }

    // A whole response, fenced when it is not plain text. It carries the
    // terminal signal for a chat turn.
    case SocketMessageType.AgentResponse:
    case SocketMessageType.Freeform: {
      const text = frameText(frame, true);
      if (index === -1) {
        if (!text) return history;
        const created = createAssistantMessage(frame, context);
        return [...history, { ...created, content: text }];
      }
      const current = history[index];
      if (!current) return history;
      const finished = isFinalResponse(frame);
      const threadId = threadIdOf(frame);
      return replaceAt(history, index, {
        content: current.content + text,
        ...(finished ? { isStreaming: false, isLoading: false, hitlInterrupt: undefined, hitlInterrupts: undefined } : {}),
        ...(finished && threadId !== undefined ? { threadId } : {}),
      });
    }

    case SocketMessageType.References: {
      if (index === -1 || !frame.references) return history;
      return replaceAt(history, index, { references: frame.references });
    }

    // Terminal for the whole execution, including pipelines whose last frame is
    // not an agent_response.
    case SocketMessageType.PipelineFinish: {
      if (index === -1) return history;
      return replaceAt(history, index, { isStreaming: false, isLoading: false });
    }

    // Failures stop the turn and surface on the message. `content` is left
    // alone: whatever streamed before the error is what the user saw, and
    // discarding it would hide how far the run got.
    case SocketMessageType.Error:
    case SocketMessageType.LlmError:
    case SocketMessageType.AgentException: {
      const exception = frame.content ?? frame['exception'] ?? type;
      if (index === -1) {
        const created = createAssistantMessage(frame, context);
        return [...history, { ...created, isStreaming: false, isLoading: false, exception }];
      }
      return replaceAt(history, index, { isStreaming: false, isLoading: false, exception });
    }

    // Not yet ported (see the module doc). Returning the input reference is the
    // point: an unported frame must be inert, never a partial write.
    default:
      return history;
  }
}
