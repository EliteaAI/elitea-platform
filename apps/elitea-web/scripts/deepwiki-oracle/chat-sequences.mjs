// The frames fed through both CHAT reducers.
//
// One sequence per branch the reducer takes, plus ORDERING sequences. A
// per-type test cannot catch a bug that only appears when two frames arrive in
// a particular order, and this reducer is full of order-dependent state: the
// active thinking block, the pending capability, and the stream filter are all
// carried in refs across frames.
export const SocketMessageType = {
  Chunk: 'chunk',
  AIMessageChunk: 'AIMessageChunk',
  AgentResponse: 'agent_response',
  AgentLlmChunk: 'agent_llm_chunk',
  AgentThinkingStep: 'agent_thinking_step',
  AgentThinkingStepUpdate: 'agent_thinking_step_update',
  AgentToolError: 'agent_tool_error',
  AgentException: 'agent_exception',
  Error: 'error',
  LlmError: 'llm_error',
};

const T = SocketMessageType;
const frame = (type, extra = {}) => ({ type, ...extra });

/** A structured thinking event, which the stream carries as a JSON STRING. */
const event = (name, data) =>
  frame(T.AgentThinkingStep, { response_metadata: { message: JSON.stringify({ event: name, data }) } });

export const SEQUENCES = {
  // ── structured thinking events, one per `event` name ────────────────────
  'event-todo-update-items': [event('todo_update', { items: [{ id: 1, title: 'Read the README' }] })],
  'event-todo-update-todos': [event('todo_update', { todos: [{ id: 2, title: 'Trace the router' }] })],
  'event-todo-update-bare-array': [event('todo_update', [{ id: 3, title: 'Bare' }])],
  // Not an array and not one of the two named shapes. The legacy code takes
  // `eventData` itself, finds it is not an array, and stores [].
  'event-todo-update-not-a-list': [event('todo_update', { unexpected: true })],

  'event-tool-start': [event('tool_start', { id: 'tool-1', tool: 'search', input: 'router' })],
  'event-tool-start-toolname-alias': [event('tool_start', { id: 'tool-2', toolName: 'grep', args: 'foo' })],
  'event-tool-start-unnamed': [event('tool_start', {})],

  'event-tool-end-alone': [event('tool_end', { id: 'tool-9', output: 'result' })],
  'event-thinking': [event('thinking', { id: 'th-1', message: 'Considering the shape' })],
  'event-thinking-title-fallback': [event('thinking', { id: 'th-2', title: 'A title' })],
  'event-llm-thinking': [event('llm_thinking', { id: 'llm-1', message: 'Drafting' })],
  'event-llm-thinking-default-message': [event('llm_thinking', { id: 'llm-2' })],
  'event-status': [event('status', { message: 'Halfway' })],
  'event-log': [event('log', { message: 'A log line' })],
  'event-unknown-with-message': [event('mystery', { message: 'Who knows' })],
  'event-unknown-with-title': [event('mystery', { title: 'Titled' })],
  // No message and no title: the legacy default stringifies the whole payload.
  'event-unknown-bare': [event('mystery', { a: 1 })],

  // ── plain-text thinking (the legacy, unstructured shape) ────────────────
  'plain-metadata-string': [
    frame(T.AgentThinkingStep, { response_metadata: { message: 'Reading files' } }),
  ],
  'plain-content-object': [frame(T.AgentThinkingStep, { content: { message: 'From content' } })],
  // The poll adapter puts the text in `content` as a STRING. Recorded so the
  // port is held to whatever the legacy reducer really does with it.
  'plain-content-string': [frame(T.AgentThinkingStep, { content: 'A bare string' })],
  'plain-nothing': [frame(T.AgentThinkingStep, {})],
  'plain-metadata-not-json': [
    frame(T.AgentThinkingStep, { response_metadata: { message: 'not { json' } }),
  ],
  // Valid JSON, but with no `event` key — so it is NOT a structured event and
  // must fall through to the plain-text path.
  'plain-metadata-json-without-event': [
    frame(T.AgentThinkingStep, { response_metadata: { message: '{"hello":"world"}' } }),
  ],
  'thinking-step-update-type': [
    frame(T.AgentThinkingStepUpdate, { response_metadata: { message: 'An update' } }),
  ],

  // ── the direct todo_update socket type (not the structured event) ───────
  'direct-todo-update-todos': [frame('todo_update', { content: { todos: [{ id: 4 }] } })],
  'direct-todo-update-bare': [frame('todo_update', { content: [{ id: 5 }] })],
  'direct-todo-update-not-a-list': [frame('todo_update', { content: { nope: 1 } })],

  // ── agent_response, one per content shape ───────────────────────────────
  'response-plain-string': [frame(T.AgentResponse, { content: 'The answer.' })],
  'response-json-array-message': [
    frame(T.AgentResponse, {
      content: JSON.stringify([{ object_type: 'message', data: 'From an array', success: true }]),
    }),
  ],
  'response-json-array-failed': [
    frame(T.AgentResponse, {
      content: JSON.stringify([{ object_type: 'message', data: 'It broke', success: false }]),
    }),
  ],
  'response-json-array-no-message-object': [
    frame(T.AgentResponse, { content: JSON.stringify([{ object_type: 'other', data: 'x' }]) }),
  ],
  'response-json-object-answer': [
    frame(T.AgentResponse, {
      content: JSON.stringify({ answer: 'Answered', sources: [{ path: 'a.md' }] }),
    }),
  ],
  'response-json-object-result-fallback': [
    frame(T.AgentResponse, { content: JSON.stringify({ result: 'Resulted' }) }),
  ],
  'response-json-object-success-false': [
    frame(T.AgentResponse, { content: JSON.stringify({ answer: 'Bad', success: false }) }),
  ],
  // An EMPTY `answer` must fall through to `result`. The legacy chains are `||`
  // and not `??`, so a nullish-only reader would stop at the empty string and
  // render a blank bubble. Nothing else in this suite reaches that difference.
  'response-json-empty-answer-falls-through': [
    frame(T.AgentResponse, { content: JSON.stringify({ answer: '', result: 'the real one' }) }),
  ],
  'response-live-empty-answer-falls-through': [
    frame(T.AgentResponse, { content: { answer: '', message: 'the real one' } }),
  ],
  // Parsed cleanly, and names NONE of the four fields. The legacy fallback is
  // the RAW STRING, not the re-serialised object — the spacing here is what
  // makes the two distinguishable.
  'response-json-object-no-known-field': [
    frame(T.AgentResponse, { content: '{ "foo" : "bar" }' }),
  ],
  // An empty `message` must fall through to `error` for the same reason.
  'error-object-empty-message-falls-through': [
    frame(T.LlmError, { content: { message: '', error: 'the real one' } }),
  ],
  // Starts with '{' so the legacy code tries JSON.parse, and it throws.
  'response-broken-json': [frame(T.AgentResponse, { content: '{not json at all' })],
  'response-live-array': [
    frame(T.AgentResponse, {
      content: [{ object_type: 'message', data: 'Live array', success: true }],
    }),
  ],
  'response-live-object': [frame(T.AgentResponse, { content: { message: 'Live object' } })],
  // No recognised field at all: the legacy code stringifies the object.
  'response-live-object-unrecognised': [frame(T.AgentResponse, { content: { odd: true } })],
  'response-empty-string': [frame(T.AgentResponse, { content: '' })],

  // ── streamed chunks ─────────────────────────────────────────────────────
  'chunk-accumulates': [
    frame(T.Chunk, { content: 'Hel' }),
    frame(T.AIMessageChunk, { content: 'lo ' }),
    frame(T.AgentLlmChunk, { content: 'world' }),
  ],
  'chunk-non-string-ignored': [frame(T.Chunk, { content: { not: 'a string' } })],

  // ── errors, one per type ────────────────────────────────────────────────
  'error-string': [frame(T.Error, { content: 'exploded' })],
  'error-object-message': [frame(T.LlmError, { content: { message: 'model refused' } })],
  'error-object-error-field': [frame(T.AgentException, { content: { error: 'raised' } })],
  'error-unreadable': [frame(T.AgentToolError, { content: 42 })],

  // ── unhandled ───────────────────────────────────────────────────────────
  'unhandled-type': [frame('references', { content: ['a.md'] })],

  // ── ORDERING: what a per-type test cannot see ───────────────────────────
  //
  // A tool_start then its tool_end MERGES into the first card rather than
  // appending a second one — the id is what joins them.
  'order-tool-start-then-end': [
    event('tool_start', { id: 'tool-7', tool: 'search', input: 'q' }),
    event('tool_end', { id: 'tool-7', output: 'found it' }),
  ],
  // A tool_end whose id matches NOTHING appends its own card.
  'order-tool-end-unmatched-id': [
    event('tool_start', { id: 'tool-7', tool: 'search' }),
    event('tool_end', { id: 'other', output: 'stray' }),
  ],
  // A tool_end with NO id matches the first step whose data also has none —
  // `undefined === undefined`. Surprising, and it is what shipped.
  'order-tool-end-no-id': [
    event('status', { message: 'A step with no data id' }),
    event('tool_end', { output: 'merged into the status step' }),
  ],
  // A NUMERIC id still joins its own start. The port stores ids as strings, so
  // this is the sequence that proves the narrowing did not break the merge.
  'order-tool-numeric-id': [
    event('tool_start', { id: 5, tool: 'search' }),
    event('tool_end', { id: 5, output: 'numeric' }),
  ],
  // Only the LATEST llm_thinking survives; the earlier one is filtered out.
  'order-llm-thinking-replaces': [
    event('llm_thinking', { id: 'llm-a', message: 'First' }),
    event('llm_thinking', { id: 'llm-b', message: 'Second' }),
  ],
  // An llm_thinking is dropped by the NEXT llm_thinking even with other steps
  // between them, and the surrounding steps keep their order.
  'order-llm-thinking-with-steps-between': [
    event('llm_thinking', { id: 'llm-a', message: 'First' }),
    event('thinking', { id: 'th-1', message: 'Middle' }),
    event('llm_thinking', { id: 'llm-b', message: 'Second' }),
  ],
  // The response CLOSES the open thinking block, then appends the answer.
  'order-steps-then-response': [
    event('thinking', { id: 'th-1', message: 'Working' }),
    frame(T.AgentResponse, { content: 'Done.' }),
  ],
  // The same for an error: the block is closed, and the error message is added
  // as an assistant turn.
  'order-steps-then-error': [
    event('thinking', { id: 'th-1', message: 'Working' }),
    frame(T.Error, { content: 'gave up' }),
  ],
  // Chunks accumulate and are then... recorded as-is. Whether the final
  // response consumes them is exactly what this sequence pins down.
  'order-chunks-then-response': [
    frame(T.Chunk, { content: 'partial ' }),
    frame(T.Chunk, { content: 'text' }),
    frame(T.AgentResponse, { content: 'the real answer' }),
  ],
  // Two responses in a row: the second finds no open block and no pending
  // capability.
  'order-two-responses': [
    frame(T.AgentResponse, { content: 'first' }),
    frame(T.AgentResponse, { content: 'second' }),
  ],
  // An error after a response.
  'order-response-then-error': [
    frame(T.AgentResponse, { content: 'ok' }),
    frame(T.Error, { content: 'then it broke' }),
  ],
};

/**
 * Sequences that need a non-default closure, because the ref state they depend
 * on is established by the SEND path rather than by an earlier frame.
 *
 * `refs` seeds the recorder; everything else is the same.
 */
export const SEEDED_SEQUENCES = {
  // A frame from ANOTHER stream is ignored entirely. This is the reducer's
  // first statement and nothing else in the suite reaches it, because the
  // filter only applies once a stream id has been claimed.
  'stream-filter-drops-foreign': {
    refs: { currentStreamIdRef: 'stream-mine' },
    frames: [
      frame(T.AgentResponse, { content: 'from elsewhere', response_metadata: { stream_id: 'stream-other' } }),
    ],
  },
  'stream-filter-admits-own': {
    refs: { currentStreamIdRef: 'stream-mine' },
    frames: [
      frame(T.AgentResponse, { content: 'mine', response_metadata: { stream_id: 'stream-mine' } }),
    ],
  },
  // No stream id on the frame at all: admitted, because the filter needs BOTH
  // sides to be present before it can disagree.
  'stream-filter-admits-unstamped': {
    refs: { currentStreamIdRef: 'stream-mine' },
    frames: [frame(T.AgentResponse, { content: 'unstamped' })],
  },
  // The capability the send path recorded is what the answer is labelled with,
  // and it is what gets persisted.
  'capability-research-carried-to-response': {
    refs: { pendingCapabilityRef: 'research' },
    frames: [frame(T.AgentResponse, { content: 'researched' })],
  },
  'capability-research-carried-to-error': {
    refs: { pendingCapabilityRef: 'research' },
    frames: [frame(T.Error, { content: 'research failed' })],
  },
  // An open thinking block, as the send path leaves it. Every structured event
  // needs one: with no active block id the updater returns early and the step
  // is DISCARDED, which is why every sequence above runs with one open.
  'no-open-block-discards-steps': {
    refs: { currentThinkingBlockIdRef: null },
    frames: [event('thinking', { id: 'th-1', message: 'Nowhere to go' })],
  },
};
