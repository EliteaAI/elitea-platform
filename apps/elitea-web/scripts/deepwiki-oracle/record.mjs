// Drive the EXTRACTED JSX reducer over a set of frame sequences and record
// everything it does. The result is the oracle the TypeScript port is held to.
import { makeJsxReducer } from './jsxReducer.generated.mjs';
import { SEQUENCES, SocketMessageType } from './sequences.mjs';

// Date.now is stubbed to a fixed clock. The reducer stamps thinking steps with
// it, and a real clock would make every recording differ from the next.
const FIXED_NOW = 1767225600000; // 2026-01-01T00:00:00Z
const realNow = Date.now;

function runSequence(frames) {
  const calls = { generationStatus: [], cleanupGeneration: 0, loadArtifactsList: [], updateGenerationState: [] };
  let thinkingSteps = [];
  const refs = Object.fromEntries(
    ['currentStreamIdRef', 'currentTaskIdRef', 'generationErroredRef', 'isReconnectingRef',
     'lastSocketEventTimeRef', 'reconnectTimeoutRef', 'socketUnsubscribeRef', 'stepIdCounterRef']
      .map((n) => [n, { current: n === 'stepIdCounterRef' ? 0 : null }]),
  );

  const reduce = makeJsxReducer({
    setGenerationStatus: (v) => { calls.generationStatus.push(v); },
    setThinkingSteps: (updater) => {
      thinkingSteps = typeof updater === 'function' ? updater(thinkingSteps) : updater;
    },
    cleanupGeneration: () => { calls.cleanupGeneration += 1; },
    getBucketName: () => 'wiki-artifacts',
    loadArtifactsList: (...args) => { calls.loadArtifactsList.push(args); },
    updateGenerationState: (...args) => { calls.updateGenerationState.push(args); },
    SocketMessageType,
    projectId: '1',
    toolkitId: '42',
    toolkit: { id: 42 },
    configuredRepoIdentity: { repository: 'acme/notes-service', branch: 'main' },
    ...refs,
  });

  Date.now = () => FIXED_NOW;
  try {
    for (const frame of frames) reduce(frame);
  } finally {
    Date.now = realNow;
  }

  return {
    generationStatus: calls.generationStatus,
    thinkingSteps,
    cleanupGenerationCalls: calls.cleanupGeneration,
    loadArtifactsListCalls: calls.loadArtifactsList.length,
    updateGenerationState: calls.updateGenerationState,
    refs: Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v.current])),
  };
}

const recorded = {};
for (const [name, frames] of Object.entries(SEQUENCES)) {
  recorded[name] = { frames, observed: runSequence(frames) };
}
process.stdout.write(JSON.stringify(recorded, null, 2) + '\n');
