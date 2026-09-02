// The frames fed through both reducers.
//
// One sequence per message type the reducer branches on, plus ORDERING
// sequences — a per-type test cannot catch a bug that only appears when two
// frames arrive in a particular order, and the generation stream is nothing
// but ordered frames.
export const SocketMessageType = {
  StartTask: 'start_task',
  Chunk: 'chunk',
  AIMessageChunk: 'AIMessageChunk',
  AgentResponse: 'agent_response',
  AgentStart: 'agent_start',
  AgentToolStart: 'agent_tool_start',
  AgentToolEnd: 'agent_tool_end',
  AgentToolError: 'agent_tool_error',
  AgentLlmStart: 'agent_llm_start',
  AgentLlmChunk: 'agent_llm_chunk',
  AgentLlmEnd: 'agent_llm_end',
  AgentThinkingStep: 'agent_thinking_step',
  AgentThinkingStepUpdate: 'agent_thinking_step_update',
  AgentException: 'agent_exception',
  References: 'references',
  Error: 'error',
  LlmError: 'llm_error',
};

const T = SocketMessageType;
const frame = (type, extra = {}) => ({ message_id: 'm1', stream_id: 's1', type, ...extra });

export const SEQUENCES = {
  // ── one per branch ──────────────────────────────────────────────────────
  'start-task-with-id': [frame(T.StartTask, { content: { task_id: 'task-7' } })],
  'start-task-without-id': [frame(T.StartTask, { content: {} })],

  'thinking-step-from-metadata': [
    frame(T.AgentThinkingStep, { response_metadata: { message: 'Reading the repository' } }),
  ],
  'thinking-step-from-content': [
    frame(T.AgentThinkingStep, { content: { message: 'Indexing files' } }),
  ],
  'thinking-step-with-no-message': [frame(T.AgentThinkingStep, {})],

  // EXACTLY what messagesFromPoll builds for a progress event since the
  // socket.io removal: the text goes into `content` as a STRING. The legacy
  // reducer reads `content?.message`, which a string does not have, so it
  // falls through to 'Processing...' and the real text is discarded.
  'thinking-step-from-poll-adapter': [
    frame(T.AgentThinkingStep, { response_metadata: {}, content: 'Cloning the repository' }),
  ],
  'thinking-step-update': [
    frame(T.AgentThinkingStepUpdate, { response_metadata: { message: 'Still indexing' } }),
  ],

  'tool-start-named': [frame(T.AgentToolStart, { response_metadata: { tool_name: 'generate_wiki' } })],
  'tool-start-unnamed': [frame(T.AgentToolStart, {})],

  'tool-end-plain': [frame(T.AgentToolEnd, { content: 'done' })],
  'tool-end-service-busy': [
    frame(T.AgentToolEnd, {
      content: JSON.stringify({ status: 'Error', error_category: 'service_busy',
        active_workers: 3, max_workers: 3, message: 'All workers are busy' }),
    }),
  ],
  'tool-end-inference-failed': [
    frame(T.AgentToolEnd, { content: JSON.stringify({ error_category: 'inference_failed' }) }),
  ],

  'agent-response-string': [frame(T.AgentResponse, { content: 'The wiki is ready.' })],
  'agent-response-object': [frame(T.AgentResponse, { content: { message: 'Generated 5 pages' } })],
  'agent-response-error-envelope': [
    frame(T.AgentResponse, { content: JSON.stringify({ status: 'Error', message: 'generation failed' }) }),
  ],
  'agent-response-array-envelope': [
    frame(T.AgentResponse, {
      content: JSON.stringify([{ object_type: 'message', data: 'Wiki generated' }]),
    }),
  ],

  'error-frame': [frame(T.Error, { content: 'boom' })],
  'llm-error-frame': [frame(T.LlmError, { content: 'model unavailable' })],
  'agent-exception-frame': [frame(T.AgentException, { content: 'traceback' })],
  'tool-error-frame': [frame(T.AgentToolError, { content: 'tool blew up' })],

  'chunk-frame': [frame(T.Chunk, { content: 'partial ' })],
  'ai-message-chunk': [frame(T.AIMessageChunk, { content: 'more text' })],
  'agent-llm-chunk': [frame(T.AgentLlmChunk, { content: 'llm text' })],

  'unhandled-type': [frame(T.References, { content: {} })],

  // ── ordering ────────────────────────────────────────────────────────────
  'happy-path': [
    frame(T.StartTask, { content: { task_id: 'task-1' } }),
    frame(T.AgentThinkingStep, { response_metadata: { message: 'Cloning' } }),
    frame(T.AgentToolStart, { response_metadata: { tool_name: 'generate_wiki' } }),
    frame(T.AgentThinkingStep, { response_metadata: { message: 'Writing pages' } }),
    frame(T.AgentToolEnd, { content: 'ok' }),
    frame(T.AgentResponse, { content: 'Wiki generated' }),
  ],
  'error-then-late-frames': [
    // The case a per-type test cannot see: once a run has errored, later
    // frames must not resurrect it into a running state.
    frame(T.StartTask, { content: { task_id: 'task-2' } }),
    frame(T.Error, { content: 'fatal' }),
    frame(T.AgentThinkingStep, { response_metadata: { message: 'still going?' } }),
    frame(T.AgentResponse, { content: 'done anyway' }),
  ],
  'two-thinking-steps-increment-ids': [
    frame(T.AgentThinkingStep, { response_metadata: { message: 'one' } }),
    frame(T.AgentThinkingStep, { response_metadata: { message: 'two' } }),
    frame(T.AgentThinkingStepUpdate, { response_metadata: { message: 'three' } }),
  ],
};
