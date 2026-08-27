/*
 * `SOCKET_EVENTS` USED TO STAND HERE and is gone with the transport. It named
 * `chat_enter_room`, `chat_leave_room`, `support_predict`, `chat_predict`,
 * `chat_conversation_name_updated` and `support_error` — six socket.io events,
 * none of which this platform emits. See `lib/hooks/stream.hook.ts`.
 *
 * `MESSAGE_TYPES` SURVIVES UNCHANGED, and that is the point: the frame
 * vocabulary is transport-agnostic. The SSE `execution.node_event` payload is
 * byte-identical to the socket's `chat_predict` receive event, so the reducer in
 * `chat.hook.ts` reads exactly the same `type` values it always did.
 */
export const MESSAGE_TYPES = {
  START_TASK: 'start_task',
  CHUNK: 'chunk',
  AI_MESSAGE_CHUNK: 'AIMessageChunk',
  AGENT_START: 'agent_start',
  AGENT_LLM_START: 'agent_llm_start',
  AGENT_LLM_CHUNK: 'agent_llm_chunk',
  AGENT_LLM_END: 'agent_llm_end',
  AGENT_TOOL_START: 'agent_tool_start',
  AGENT_TOOL_END: 'agent_tool_end',
  AGENT_ON_TRANSITIONAL_EDGE: 'agent_on_transitional_edge',
  AGENT_ON_FUNCTION_TOOL_NODE: 'agent_on_function_tool_node',
  AGENT_RESPONSE: 'agent_response',
  PIPELINE_FINISH: 'pipeline_finish',
  ERROR: 'error',
  AGENT_EXCEPTION: 'agent_exception',
} as const;
