/**
 * lib/chatStreamFrame.ts — the chat streaming wire vocabulary (issue #93).
 *
 * One envelope, two transports. The socket delivered these frames as
 * `chat_predict` receive events; the Go runtime delivers the SAME payload as
 * the `data` of an SSE `execution.node_event` (verified against a live stack:
 * the frame even carries `sio_event: "chat_predict"`, the emit it answers).
 * `shared/api/sse/executionEvents.ts` documents why the SSE event NAME is
 * `execution.node_event` rather than the `chat.stream.chunk` / `chat.stream.done`
 * that issue #93's table predicted — those names exist in no backend.
 *
 * Because the payload is identical, the reducer that consumes these frames is
 * transport-agnostic: `features/toolkits` already proves the pattern by casting
 * an `ExecutionEventData` straight into its socket-shaped handler
 * (`useToolkitChatSocket.hooks.ts:65-67`).
 *
 * `SocketMessageType` is the FULL baseline vocabulary
 * (`EliteaUI/src/common/constants.js:157-192`), not the subset the current
 * reducer slice handles. Listing every member is deliberate: an unhandled type
 * must be visibly unhandled — a trimmed enum turns "not ported yet" into
 * "unknown frame", which is how a half-migrated surface drops output silently.
 */

/** Every `type` the chat stream can carry. Ported verbatim from the baseline. */
export const SocketMessageType = {
  AgentStart: 'agent_start',
  AgentResponse: 'agent_response',
  AgentException: 'agent_exception',
  AgentToolStart: 'agent_tool_start',
  AgentToolEnd: 'agent_tool_end',
  AgentToolError: 'agent_tool_error',
  AgentRequiresConfirmation: 'agent_requires_confirmation',
  AgentHitlInterrupt: 'agent_hitl_interrupt',
  McpAuthorizationRequired: 'mcp_authorization_required',
  AgentLlmStart: 'agent_llm_start',
  AgentLlmChunk: 'agent_llm_chunk',
  AgentLlmEnd: 'agent_llm_end',
  AgentOnFunctionToolNode: 'agent_on_function_tool_node',
  AgentOnToolNode: 'agent_on_tool_node',
  AgentOnTransitionalEdge: 'agent_on_transitional_edge',
  AgentOnConditionalEdge: 'agent_on_conditional_edge',
  AgentOnDecisionEdge: 'agent_on_decision_edge',
  References: 'references',
  Chunk: 'chunk',
  AIMessageChunk: 'AIMessageChunk',
  ChatUserMessage: 'chat_user_message',
  StartTask: 'start_task',
  Freeform: 'freeform',
  Error: 'error',
  LlmError: 'llm_error',
  PipelineFinish: 'pipeline_finish',
  AgentThinkingStep: 'agent_thinking_step',
  AgentThinkingStepUpdate: 'agent_thinking_step_update',
  ChatPredictSummaryStarted: 'chat_predict_summary_started',
  ChatPredictSummaryFinished: 'chat_predict_summary_finished',
  SwarmChildMessage: 'swarm_child_message',
  AgentSwarmAgentStart: 'agent_swarm_agent_start',
  AgentSwarmAgentResponse: 'agent_swarm_agent_response',
  AgentSwarmHandoff: 'agent_swarm_handoff',
} as const;

/**
 * The types THIS slice reduces. Everything else in `SocketMessageType` is a
 * later slice (tool nodes, thinking steps, HITL, MCP authorization, swarm,
 * summaries, edges) — see the reducer's module doc for the running list.
 *
 * Exported so a caller can tell "we chose not to render this yet" from "the
 * backend sent something nobody has ever seen", and so a test can assert the
 * boundary rather than infer it.
 */
export const HANDLED_STREAM_TYPES: ReadonlySet<string> = new Set<string>([
  SocketMessageType.StartTask,
  SocketMessageType.AgentStart,
  SocketMessageType.AgentLlmStart,
  SocketMessageType.AgentLlmChunk,
  SocketMessageType.Chunk,
  SocketMessageType.AIMessageChunk,
  SocketMessageType.AgentLlmEnd,
  SocketMessageType.AgentResponse,
  SocketMessageType.References,
  SocketMessageType.PipelineFinish,
  SocketMessageType.Freeform,
  SocketMessageType.Error,
  SocketMessageType.LlmError,
  SocketMessageType.AgentException,
]);

/**
 * The response metadata the reducer reads. The baseline treats this blob as
 * open — it carries provider, langgraph and pipeline detail this slice does not
 * interpret — so unknown members are preserved rather than typed away.
 */
interface StreamResponseMetadata {
  readonly finish_reason?: string | undefined;
  readonly thread_id?: string | undefined;
  readonly metadata?: { readonly thread_id?: string | undefined; readonly [key: string]: unknown } | undefined;
  readonly [key: string]: unknown;
}

/**
 * One streaming frame.
 *
 * `message_id` identifies the ASSISTANT message being streamed and
 * `question_id` the user turn it replies to; the baseline resolves a frame to
 * an existing message by either, because the two arrive in different frames
 * (`hooks.js:391-404`). Both are optional on the wire, which is why the reducer
 * has to tolerate a frame that identifies nothing.
 */
export interface ChatStreamFrame {
  readonly type?: string | undefined;
  readonly message_id?: string | undefined;
  readonly question_id?: string | undefined;
  readonly stream_id?: string | undefined;
  readonly content?: unknown;
  readonly thinking?: string | undefined;
  readonly response_metadata?: StreamResponseMetadata | undefined;
  readonly references?: readonly unknown[] | undefined;
  readonly created_at?: string | number | undefined;
  readonly sio_event?: string | undefined;
  readonly [key: string]: unknown;
}

/** Narrows an untyped SSE/socket payload to a frame worth reducing. */
export function isChatStreamFrame(value: unknown): value is ChatStreamFrame {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
