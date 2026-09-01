/**
 * Drive one conversation: send a question, poll its invocation, feed the frames
 * to the reducer.
 *
 * HEADLESS. There is no JSX in this slice at all. The drawer that renders it
 * lives at `widgets/deepwiki`, because reusing the chat message components
 * means importing `features/chat-messages`, and `no-sideways-features` allows
 * that only from a widget. Splitting here is not a workaround for the rule —
 * it is what lets the conversation be tested without a drawer.
 *
 * EXACTLY ONE POLLER, for the reason the generation hook states: `custom_events`
 * is read-once, so two pollers each consume events the other never sees and the
 * visible symptom is a thinking log missing half its cards.
 *
 * EVERY DOOR TO THE WORLD IS INJECTED — invoke, poll, the clock, the id
 * generator and the storage. Not for purity: it is what makes "the request
 * failed before it started" a test instead of a network fixture.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { framesFromChatPoll, isTerminalChatPoll, type ChatInvocationPoll } from '../lib/framesFromChatPoll';
import { reduceChatFrames } from './reducer';
import { capabilityOnOpen, chatHistory, failTurn, openTurn, rewindToLastQuestion, toolNameFor } from './turn';
import { initialChatState, type ChatCapability, type ChatMessage, type ChatState } from './types';

/**
 * How often a running invocation is polled, in milliseconds.
 *
 * Not exported: nothing outside this slice names it. A caller that needs a
 * different cadence passes `intervalMs`, which is what the tests do — an
 * exported constant with no importer is the dead-code shape this repository has
 * removed six times (#126/#129/#134/#136/#138/#149).
 */
const CHAT_POLL_INTERVAL_MS = 2000;

/** What the caller must supply to start one request. */
export interface ChatInvokeInput {
  readonly toolName: string;
  readonly question: string;
  readonly history: readonly { role: 'user' | 'assistant'; content: string }[];
  readonly capability: ChatCapability;
  readonly streamId: string;
  readonly messageId: string;
}

export interface WikiChatOptions {
  /** Start the invocation. Resolves to its id. */
  readonly invoke: (input: ChatInvokeInput) => Promise<string>;
  /** Fetch one poll of a running invocation. */
  readonly poll: (invocationId: string) => Promise<ChatInvocationPoll | undefined>;
  /** Read and write the conversation and the last capability. */
  readonly storage: ChatStorage;
  /** A fresh identifier. Injected so a test can make ids predictable. */
  readonly newId: () => string;
  readonly intervalMs?: number;
}

/**
 * The two things that outlive a mount.
 *
 * Deliberately an interface rather than a direct `localStorage` reach: the raw
 * global escapes the namespaced sweep that logout runs, which is how keys
 * survive a sign-out (issue #22). The widget passes a namespaced store.
 */
export interface ChatStorage {
  readonly loadMessages: () => readonly ChatMessage[];
  readonly saveMessages: (messages: readonly ChatMessage[]) => void;
  readonly loadCapability: () => ChatCapability | null;
  readonly saveCapability: (capability: ChatCapability) => void;
}

export interface WikiChatController {
  readonly state: ChatState;
  readonly send: (question: string) => void;
  readonly regenerate: () => void;
  readonly clear: () => void;
  readonly setMode: (mode: ChatCapability) => void;
  /** Restore the capability the last answer was produced with. */
  readonly restoreCapability: () => void;
}

export function useWikiChat(options: WikiChatOptions): WikiChatController {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [state, setState] = useState<ChatState>(() => ({
    ...initialChatState,
    messages: options.storage.loadMessages(),
    mode: options.storage.loadCapability() ?? 'ask',
  }));

  // The poller reads the live state through a ref. Without it the effect would
  // depend on `state` and restart on every frame — draining read-once events
  // into a poller that is about to be replaced.
  const stateRef = useRef(state);
  stateRef.current = state;

  const [invocationId, setInvocationId] = useState<string | null>(null);

  // Persist on every change, including the ones the stream makes. The legacy
  // component did the same, and it is what lets a reload land back in the
  // conversation rather than an empty drawer.
  useEffect(() => {
    optionsRef.current.storage.saveMessages(state.messages);
  }, [state.messages]);

  const start = useCallback((question: string, from: readonly ChatMessage[]) => {
    const trimmed = question.trim();
    const current = stateRef.current;
    if (trimmed === '' || current.isLoading) return;

    const { newId, invoke, storage } = optionsRef.current;
    const capability = current.mode;
    const blockId = newId();
    const streamId = newId();
    const messageId = newId();
    // The history is taken from the messages the turn STARTS from, not from
    // the state after the question is appended: the model must not be handed
    // the question it is being asked as prior context.
    const history = chatHistory(from);

    const opened = openTurn(
      { ...current, messages: from },
      { question: trimmed, capability, blockId, streamId, messageId },
    );
    setState(opened);

    void invoke({ toolName: toolNameFor(capability), question: trimmed, history, capability, streamId, messageId })
      .then((id) => {
        setInvocationId(id);
      })
      .catch((error: unknown) => {
        // The request never started, so no frame will ever close the block.
        // failTurn removes it; leaving it would spin for ever.
        const message = error instanceof Error ? error.message : 'The request failed.';
        setState((previous) => failTurn(previous, blockId, message));
        storage.saveCapability(capability);
      });
  }, []);

  const send = useCallback(
    (question: string) => {
      start(question, stateRef.current.messages);
    },
    [start],
  );

  const regenerate = useCallback(() => {
    const rewound = rewindToLastQuestion(stateRef.current.messages);
    if (!rewound) return;
    // Everything after the question goes, so the model is not shown the answer
    // it is being asked to replace.
    start(rewound.question, rewound.messages);
  }, [start]);

  const clear = useCallback(() => {
    setState((previous) => ({ ...initialChatState, mode: previous.mode }));
    setInvocationId(null);
  }, []);

  const setMode = useCallback((mode: ChatCapability) => {
    setState((previous) => ({ ...previous, mode }));
  }, []);

  const restoreCapability = useCallback(() => {
    const { storage } = optionsRef.current;
    const next = capabilityOnOpen(stateRef.current.messages, storage.loadCapability());
    if (next) setState((previous) => (previous.mode === next ? previous : { ...previous, mode: next }));
  }, []);

  useEffect(() => {
    if (!invocationId) return undefined;

    let cancelled = false;
    let inFlight = false;
    let settled = false;

    const tick = async (): Promise<void> => {
      // One request at a time. A poll slower than the interval would otherwise
      // overlap the next and the two would race for the same read-once events.
      if (inFlight || cancelled || settled) return;
      inFlight = true;
      try {
        const poll = await optionsRef.current.poll(invocationId);
        if (cancelled) return;
        const frames = framesFromChatPoll(poll, { streamId: stateRef.current.streamId ?? invocationId });
        if (frames.length > 0) {
          setState((previous) => {
            const { state: next, effects } = reduceChatFrames(previous, frames);
            for (const effect of effects) {
              if (effect.kind === 'persistCapability') {
                optionsRef.current.storage.saveCapability(effect.capability);
              }
            }
            return next;
          });
        }
        if (isTerminalChatPoll(poll)) settled = true;
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), optionsRef.current.intervalMs ?? CHAT_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [invocationId]);

  return { state, send, regenerate, clear, setMode, restoreCapability };
}
