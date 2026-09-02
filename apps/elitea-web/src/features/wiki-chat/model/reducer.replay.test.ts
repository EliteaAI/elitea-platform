/**
 * Replay the TypeScript reducer against a RECORDING of the legacy one.
 *
 * The per-frame tests next door say what each branch does. They cannot say that
 * this port does what the code it replaces did — for that you need the original
 * running, and it only runs sliced out of its component. That is what
 * scripts/deepwiki-oracle/{extract-chat-reducer,record-chat}.mjs produce and
 * what chat-oracle.json holds.
 *
 * Regenerate after touching apps/deepwiki-ui:
 *
 *   node scripts/deepwiki-oracle/extract-chat-reducer.mjs
 *   node scripts/deepwiki-oracle/record-chat.mjs > \
 *     src/features/wiki-chat/model/__fixtures__/chat-oracle.json
 *
 * A regeneration that CHANGES this file's fixture is a change in the legacy
 * behaviour, and it has to be read, not accepted.
 */
import { describe, expect, it } from 'vitest';

import oracle from './__fixtures__/chat-oracle.json';
import { reduceChatFrames } from './reducer';
import { isThinkingBlock, type ChatCapability, type ChatFrame, type ChatState } from './types';

/** The clock the recording was taken with. */
const FIXED_NOW = 1767225600000;

/** The block the legacy send path leaves open, reproduced here. */
const OPEN_BLOCK_ID = 'block-1';

function initialState(seedRefs: Record<string, unknown>): ChatState {
  return {
    messages: [
      { role: 'user', content: 'Where is the router?' },
      { type: 'thinking_steps', id: OPEN_BLOCK_ID, status: 'running', steps: [] },
    ],
    todos: null,
    activeBlockId:
      'currentThinkingBlockIdRef' in seedRefs
        ? (seedRefs['currentThinkingBlockIdRef'] as string | null)
        : OPEN_BLOCK_ID,
    pendingCapability: (seedRefs['pendingCapabilityRef'] as ChatCapability | null) ?? null,
    streamId: (seedRefs['currentStreamIdRef'] as string | null) ?? null,
    messageId: (seedRefs['currentMessageIdRef'] as string | null) ?? 'msg-1',
    mode: 'ask',
    isLoading: false,
    error: null,
    streamingText: '',
  };
}

/**
 * ONE narrowing, and it is named rather than hidden.
 *
 * The legacy reducer stored a step id exactly as the payload sent it, so a
 * numeric id stayed a number. This port stores strings. The merge still works
 * — `order-tool-numeric-id` is in the oracle to prove it — so the difference is
 * in the recorded VALUE and nowhere else, and normalising it here is the honest
 * way to compare. Normalising anything else would start hiding real drift.
 */
function normaliseIds(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, entry: unknown) =>
      key === 'id' && typeof entry === 'number' ? String(entry) : entry,
    ),
  ) as unknown;
}

describe('the chat reducer reproduces the legacy one', () => {
  const cases = Object.entries(
    oracle as Record<
      string,
      { frames: ChatFrame[]; seedRefs: Record<string, unknown>; observed: Record<string, unknown> }
    >,
  );

  // The floor. A fixture that failed to load, or an oracle regenerated from a
  // sequence file somebody emptied, would otherwise run zero cases and report a
  // pass — the failure mode this repository keeps meeting.
  it('replays every recorded sequence', () => {
    expect(cases.length).toBeGreaterThanOrEqual(65);
  });

  it.each(cases)('%s', (_name, recorded) => {
    const { state, effects } = reduceChatFrames(
      initialState(recorded.seedRefs),
      recorded.frames,
      { now: () => FIXED_NOW },
    );
    const observed = recorded.observed;

    expect(normaliseIds(state.messages)).toEqual(normaliseIds(observed['messages']));
    expect(state.todos).toEqual(observed['researchTodos']);

    // The refs the legacy code carried, now state.
    const refs = observed['refs'] as Record<string, unknown>;
    expect(state.streamId).toEqual(refs['currentStreamIdRef']);
    expect(state.messageId).toEqual(refs['currentMessageIdRef']);
    expect(state.activeBlockId).toEqual(refs['currentThinkingBlockIdRef']);
    expect(state.pendingCapability).toEqual(refs['pendingCapabilityRef']);

    // The setter calls, as effects and as settled state.
    const persisted = observed['persistedCapabilities'] as ChatCapability[];
    expect(effects.filter((e) => e.kind === 'persistCapability').map((e) => e.capability)).toEqual(
      persisted,
    );
    expect(effects.filter((e) => e.kind === 'unsubscribe')).toHaveLength(
      observed['unsubscribeCalls'] as number,
    );

    const modeCalls = observed['setChatModeCalls'] as ChatCapability[];
    if (modeCalls.length > 0) {
      expect(state.mode).toBe(modeCalls[modeCalls.length - 1]);
    } else {
      expect(state.mode).toBe('ask');
    }

    const loadingCalls = observed['setIsLoadingCalls'] as boolean[];
    expect(state.isLoading).toBe(
      loadingCalls.length > 0 ? loadingCalls[loadingCalls.length - 1] : false,
    );

    const errorCalls = observed['setErrorCalls'] as (string | null)[];
    expect(state.error).toBe(errorCalls.length > 0 ? errorCalls[errorCalls.length - 1] : null);
  });

  /**
   * The accumulation is pinned to the original FRAME FOR FRAME; only the two
   * rules around it differ.
   *
   * The legacy `pendingAnswer` was write-only — nothing rendered it and nothing
   * cleared it — so its recorded value is a clean record of what the provider
   * streamed. This port renders that text (DWIKI-012), which forces one change:
   * a COMPLETED turn clears it, because the finished answer replaces it. Every
   * other sequence must match the recording exactly, including the ones that
   * end in a failure.
   */
  it('accumulates exactly what the legacy did, and clears it only on a completed turn', () => {
    let compared = 0;
    for (const [name, recorded] of cases) {
      const completed = recorded.frames.some((frame) => frame.type === 'agent_response');
      const { state } = reduceChatFrames(initialState(recorded.seedRefs), recorded.frames, {
        now: () => FIXED_NOW,
      });
      expect(state.streamingText, name).toBe(
        completed ? '' : (recorded.observed['pendingAnswer'] as string),
      );
      compared += 1;
    }
    expect(compared).toBe(cases.length);
  });

  it('really does have something to compare — the recording is not all empty', () => {
    // Without this the assertion above passes vacuously: every sequence
    // recording `pendingAnswer: ""` would match a port that never accumulated.
    const recorded = (oracle as Record<string, { frames: ChatFrame[]; observed: Record<string, unknown> }>)[
      'order-chunks-then-response'
    ];
    expect(recorded?.observed['pendingAnswer']).toBe('partial text');

    // And that sequence COMPLETES, so the port shows the answer and not the
    // fragments — which is what the legacy displayed too, for the wrong reason.
    const { state } = reduceChatFrames(initialState({}), recorded?.frames ?? [], {
      now: () => FIXED_NOW,
    });
    expect(state.streamingText).toBe('');
    const last = state.messages[state.messages.length - 1];
    expect(last && !isThinkingBlock(last) ? last.content : null).toBe('the real answer');
  });

  it('keeps an interrupted stream visible, which the legacy could not', () => {
    const { state } = reduceChatFrames(
      initialState({}),
      [
        { type: 'chunk', content: 'half an ans' },
        { type: 'error', content: 'the connection dropped' },
      ],
      { now: () => FIXED_NOW },
    );
    expect(state.streamingText).toBe('half an ans');
  });
});
