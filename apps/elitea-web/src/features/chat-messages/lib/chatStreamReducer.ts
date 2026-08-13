/**
 * lib/chatStreamReducer.ts — the chat streaming reducer (issue #93, Surface B).
 *
 * PORT STATUS — slices 1-2 (core streaming, then the tool lifecycle). The baseline reducer is
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
 *   graph nodes       agent_on_function_tool_node, agent_on_tool_node and the
 *                     three agent_on_*_edge frames (progress chips, not tool
 *                     lifecycle)
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
 * SIDE EFFECTS ARE NOT PORTED, and that is a boundary rather than an omission.
 * The baseline's tool cases also fire Google Analytics events, write
 * `window.__lastToolMetaFull`, and call `McpAuthHelpers.setSessionId` when a
 * tool reports an MCP session. A pure reducer cannot do any of that. The
 * metadata those effects read is preserved verbatim on `toolMeta`, so the hook
 * that eventually drives this reducer can perform them from the same frame —
 * see `mcpSessionFromFrame`, which extracts exactly that pair for a caller.
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
import { TOOL_ACTION_TYPES, ToolActionStatus } from '@/shared/lib/chat';

import { normalizeExecutionHierarchy } from './executionHierarchy';

import type { SubAgentGroupable } from '@/entities/message/lib/subAgentGrouping';

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
 * One entry in a message's tool timeline. Left open deliberately: the baseline
 * writes provider- and toolkit-specific members onto these objects and the
 * rendering layer reads them by name, so narrowing the shape here would drop
 * data the UI still needs.
 */
export interface ToolAction extends SubAgentGroupable {
  readonly id: string;
  readonly status: string;
  readonly toolMeta?: Record<string, unknown> | undefined;
  readonly [key: string]: unknown;
}

/**
 * The metadata a tool frame carries, merged the way the baseline merges it:
 * `tool_meta.metadata` wins over `response_metadata.metadata`, because the
 * LangChain tool's own metadata is the more specific of the two.
 */
function toolMetadata(frame: ChatStreamFrame): Record<string, unknown> {
  const responseMetadata = frame.response_metadata;
  return {
    ...responseMetadata?.metadata,
    ...responseMetadata?.tool_meta?.metadata,
  };
}

/**
 * Recover a toolkit name the metadata omitted from the tool's description.
 * Two shapes are in the wild — `[Toolkit: name]` (vectorstore, inventory) and a
 * `Toolkit: name` line (most others) — and the baseline tries both before
 * giving up, which is why a single regex here would silently unlabel toolkits.
 */
function toolkitNameFromDescription(description: unknown): string {
  if (typeof description !== 'string') return '';
  const bracketed = /\[Toolkit:\s*([^\]]+)]/.exec(description);
  if (bracketed?.[1]) return bracketed[1].trim();
  const line = /(?:^|\n)Toolkit:\s*([^\n]+)/.exec(description);
  return line?.[1]?.trim() ?? '';
}

/** Toolkit identity, in the baseline's precedence order. */
function toolkitIdentity(frame: ChatStreamFrame, metadata: Record<string, unknown>): {
  readonly name: string;
  readonly type: string;
} {
  const responseMetadata = frame.response_metadata;
  const rawToolName = responseMetadata?.tool_name ?? '';
  // The pre-rename wire format encoded the toolkit in the tool name itself.
  const legacyToolkit = rawToolName.includes('___') ? (rawToolName.split('___')[0] ?? '') : '';
  const fromMetadata = typeof metadata['toolkit_name'] === 'string' ? (metadata['toolkit_name'] as string) : '';
  const fromDescription = toolkitNameFromDescription(responseMetadata?.tool_meta?.description);
  const typeFromMetadata = typeof metadata['toolkit_type'] === 'string' ? (metadata['toolkit_type'] as string) : '';
  return {
    name: fromMetadata || fromDescription || responseMetadata?.toolkit_name || legacyToolkit,
    type: typeFromMetadata || responseMetadata?.toolkit_type || '',
  };
}

/**
 * The tool's display name. A lazy-loading wrapper puts its own class name in
 * `tool_name` and signals the swap with `metadata.original_name`; the real name
 * is then on `tool_meta.name`, and preferring it is what stops the UI showing
 * "LazyLoading" instead of the tool the user invoked.
 */
function toolDisplayName(frame: ChatStreamFrame, metadata: Record<string, unknown>): string | undefined {
  const responseMetadata = frame.response_metadata;
  const wrapped = metadata['original_name'] && responseMetadata?.tool_meta?.name;
  return wrapped ? (responseMetadata.tool_meta?.name as string) : responseMetadata?.tool_name;
}

function findToolAction(message: ChatMessage, runId: string | undefined): ToolAction | undefined {
  if (!runId) return undefined;
  const actions = message.toolActions as readonly ToolAction[] | undefined;
  return actions?.find((action) => action.id === runId);
}

/** Replace one tool action by id, preserving order and leaving the rest untouched. */
function replaceToolAction(
  message: ChatMessage,
  runId: string,
  update: (action: ToolAction) => ToolAction,
): readonly ToolAction[] {
  const actions = (message.toolActions ?? []) as readonly ToolAction[];
  return actions.map((action) => (action.id === runId ? update(action) : action));
}

/**
 * The MCP session a tool frame reports, for a CALLER to persist.
 *
 * The baseline calls `McpAuthHelpers.setSessionId` from inside the reducer.
 * That is I/O, so it cannot live here — but dropping it would silently break
 * MCP re-authorization, so the pair is surfaced instead of discarded.
 */
export function mcpSessionFromFrame(
  frame: ChatStreamFrame,
): { readonly serverUrl: string; readonly sessionId: string } | undefined {
  const metadata = toolMetadata(frame);
  const sessionId = metadata['mcp_session_id'];
  const serverUrl = metadata['mcp_server_url'];
  if (typeof sessionId !== 'string' || typeof serverUrl !== 'string' || !sessionId || !serverUrl) return undefined;
  return { serverUrl, sessionId };
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


    // A tool started. Creates the timeline entry the UI renders as a chip; a
    // repeat for the same run id updates ancestry rather than duplicating it.
    case SocketMessageType.AgentToolStart: {
      if (index === -1) return history;
      const current = history[index];
      const runId = frame.response_metadata?.tool_run_id;
      if (!current || !runId) return history;
      const metadata = toolMetadata(frame);
      const hierarchy = normalizeExecutionHierarchy(metadata, frame.response_metadata);
      const threadId = threadIdOf(frame);
      const existing = findToolAction(current, runId);

      if (existing) {
        return replaceAt(history, index, {
          toolActions: replaceToolAction(current, runId, (action) => ({
            ...action,
            ...hierarchy,
            toolMeta: { ...action.toolMeta, ...metadata, ...hierarchy },
          })),
          ...(threadId !== undefined ? { threadId } : {}),
        });
      }

      const toolkit = toolkitIdentity(frame, metadata);
      // Built imperatively, not with conditional spreads: spreading a
      // `{name: X} | {}` union infers `name?: X | undefined`, which
      // `exactOptionalPropertyTypes` rejects against `SubAgentGroupable`'s
      // "absent or string". Same convention as
      // `useToolkitChatSocket.hooks.ts:79-90`.
      const draft: Record<string, unknown> = {
        id: runId,
        type: TOOL_ACTION_TYPES.Tool,
        status: ToolActionStatus.processing,
        message: '',
        ...hierarchy,
        toolInputs: frame.response_metadata?.tool_inputs,
        toolOutputs: frame.response_metadata?.tool_outputs,
        toolMeta: { ...metadata, toolkit_type: toolkit.type, toolkit_name: toolkit.name, ...hierarchy },
        created_at: frame.response_metadata?.timestamp_start ?? frame.created_at,
      };
      const displayName = toolDisplayName(frame, metadata);
      if (displayName !== undefined) draft['name'] = displayName;
      if (typeof metadata['original_name'] === 'string') draft['original_name'] = metadata['original_name'];
      const created = draft as unknown as ToolAction;
      return replaceAt(history, index, {
        toolActions: [...((current.toolActions ?? []) as readonly ToolAction[]), created],
        ...(threadId !== undefined ? { threadId } : {}),
      });
    }

    // The tool returned. Outputs ACCUMULATE — a string appends, an object
    // merges — because a tool may report progressively, and replacing would
    // discard everything but the last frame.
    case SocketMessageType.AgentToolEnd: {
      if (index === -1) return history;
      const current = history[index];
      const runId = frame.response_metadata?.tool_run_id;
      if (!current || !runId || !findToolAction(current, runId)) return history;
      const metadata = toolMetadata(frame);

      return replaceAt(history, index, {
        toolActions: replaceToolAction(current, runId, (action) => {
          const hierarchy = normalizeExecutionHierarchy(metadata, action, action.toolMeta);
          const output = frame.response_metadata?.tool_output;
          const previous = action['toolOutputs'];
          let toolOutputs = previous;
          if (typeof output === 'string') {
            toolOutputs = (typeof previous === 'string' ? previous : '') + convertJsonToString(output, true);
          } else if (typeof output === 'object' && output !== null) {
            toolOutputs = { ...((typeof previous === 'object' && previous !== null ? previous : {}) as object), ...output };
          }
          return {
            ...action,
            ...hierarchy,
            toolOutputs,
            message: undefined,
            content: convertJsonToString(frame.content ?? ''),
            // An action awaiting approval stays awaiting it: the wrapper ending
            // is not the user answering.
            status: action.status === ToolActionStatus.actionRequired ? action.status : ToolActionStatus.complete,
            ended_at: frame.response_metadata?.timestamp_finish ?? frame.created_at,
            created_at: frame.response_metadata?.timestamp_start ?? action['created_at'],
            toolMeta: { ...action.toolMeta, ...metadata, ...hierarchy },
          };
        }),
      });
    }

    case SocketMessageType.AgentToolError: {
      if (index === -1) return history;
      const current = history[index];
      const runId = frame.response_metadata?.tool_run_id;
      if (!current || !runId || !findToolAction(current, runId)) return history;
      const metadata = toolMetadata(frame);

      return replaceAt(history, index, {
        toolActions: replaceToolAction(current, runId, (action) => {
          const hierarchy = normalizeExecutionHierarchy(metadata, action, action.toolMeta);
          return {
            ...action,
            ...hierarchy,
            content: convertJsonToString(frame.content ?? ''),
            status: ToolActionStatus.error,
            ended_at: frame.created_at,
            isError: true,
            toolMeta: { ...action.toolMeta, ...metadata, ...hierarchy },
          };
        }),
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
