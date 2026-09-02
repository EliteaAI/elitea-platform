// Drive the EXTRACTED JSX chat reducer over a set of frame sequences and record
// everything it does. The result is the oracle the TypeScript port is held to.
import { makeJsxChatReducer } from './chatReducer.generated.mjs';
import { SEQUENCES, SEEDED_SEQUENCES, SocketMessageType } from './chat-sequences.mjs';

// Date.now is stubbed to a fixed clock. The reducer stamps generated step ids
// with it, and a real clock would make every recording differ from the next.
const FIXED_NOW = 1767225600000; // 2026-01-01T00:00:00Z
const realNow = Date.now;

// The reducer logs on four paths, including console.error. Silencing it keeps
// the recording readable; it is restored before the process writes anything.
const realLog = console.log;
const realError = console.error;

/** The thinking block the send path opens before it emits. */
const OPEN_BLOCK_ID = 'block-1';

function initialMessages() {
  return [
    { role: 'user', content: 'Where is the router?' },
    { type: 'thinking_steps', id: OPEN_BLOCK_ID, status: 'running', steps: [] },
  ];
}

function runSequence(frames, seedRefs = {}) {
  const calls = { persistLastCapability: [], chatMode: [], isLoading: [], error: [], unsubscribe: 0 };
  let messages = initialMessages();
  let researchTodos = null;
  let pendingAnswer = '';

  const refs = {
    currentStreamIdRef: { current: null },
    currentMessageIdRef: { current: 'msg-1' },
    currentThinkingBlockIdRef: { current: OPEN_BLOCK_ID },
    pendingCapabilityRef: { current: null },
    ...Object.fromEntries(Object.entries(seedRefs).map(([k, v]) => [k, { current: v }])),
  };

  const reduce = makeJsxChatReducer({
    setMessages: (updater) => {
      messages = typeof updater === 'function' ? updater(messages) : updater;
    },
    setResearchTodos: (v) => { researchTodos = v; },
    setPendingAnswer: (updater) => {
      pendingAnswer = typeof updater === 'function' ? updater(pendingAnswer) : updater;
    },
    setError: (v) => { calls.error.push(v); },
    setIsLoading: (v) => { calls.isLoading.push(v); },
    setChatMode: (v) => { calls.chatMode.push(v); },
    persistLastCapability: (v) => { calls.persistLastCapability.push(v); },
    SocketMessageType,
    MAX_THINKING_STEPS_PER_RUN: 200,
    ...refs,
    socketUnsubscribeRef: { current: () => { calls.unsubscribe += 1; } },
  });

  Date.now = () => FIXED_NOW;
  console.log = () => {};
  console.error = () => {};
  try {
    for (const frame of frames) reduce(frame);
  } finally {
    Date.now = realNow;
    console.log = realLog;
    console.error = realError;
  }

  return {
    messages,
    researchTodos,
    pendingAnswer,
    setChatModeCalls: calls.chatMode,
    persistedCapabilities: calls.persistLastCapability,
    setIsLoadingCalls: calls.isLoading,
    setErrorCalls: calls.error,
    unsubscribeCalls: calls.unsubscribe,
    refs: Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v.current])),
  };
}

const recorded = {};
for (const [name, frames] of Object.entries(SEQUENCES)) {
  recorded[name] = { frames, seedRefs: {}, observed: runSequence(frames) };
}
for (const [name, spec] of Object.entries(SEEDED_SEQUENCES)) {
  recorded[name] = {
    frames: spec.frames,
    seedRefs: spec.refs,
    observed: runSequence(spec.frames, spec.refs),
  };
}
process.stdout.write(JSON.stringify(recorded, null, 2) + '\n');
