/**
 * Regression cover for the two silent-drop defects in `useChatBoxHandlers`.
 *
 * DEFECT 1 — a send that reached no transport reported success.
 * `sendQuestion` fell back to `emitSocket('chat_predict', …)` whenever the
 * REST start did not take the run, and then IGNORED the emit's return value.
 * On a deployment whose `/app/config.js` serves `vite_socket_server: ""` the
 * injected client is `createNoopSocketClient()`, whose `emit` is `() => false`
 * (`shared/api/socket/client.ts`) — so the question was dropped with no
 * answer, no error and a `{ success: true }` result that told the composer to
 * clear the user's text.
 *
 * DEFECT 2 — a continuation that reached no transport left the bubble stuck.
 * `continueHitl` / `resumeMcpFlow` / `continueTokenLimit` first wipe the
 * approval card and set `isLoading`/`isStreaming` on the message, then emit
 * `chat_continue_predict` into the same no-op client. The wipe was
 * unconditional and irreversible, so the run stayed paused server-side while
 * the card was gone and the message spun for the rest of the session.
 *
 * `useChatBoxHandlers` calls no React hook of its own — it only builds
 * closures over `deps` — so these tests invoke it directly.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@/features/chat-messages';
import { ROLES } from '@/shared/lib/enums';

import { useChatBoxHandlers } from './useChatBoxHandlers';
import type { ChatBoxHandlerDeps, StreamStartOutcome } from './useChatBoxHandlers.helpers';

/** A `setChatHistory` backed by a plain array, so a test can read the result. */
function makeHistory(seed: readonly ChatMessage[]): {
  readonly read: () => readonly ChatMessage[];
  readonly setChatHistory: ChatBoxHandlerDeps['setChatHistory'];
} {
  let current = seed;
  return {
    read: () => current,
    setChatHistory: (update) => {
      current = typeof update === 'function' ? update(current) : update;
    },
  };
}

function makeDeps(overrides: Partial<ChatBoxHandlerDeps> & { readonly setChatHistory: ChatBoxHandlerDeps['setChatHistory'] }): ChatBoxHandlerDeps {
  return {
    emitSocket: () => true,
    chatHistory: [],
    setStreamingInfo: () => undefined,
    projectId: 1,
    conversationUuid: 'conv-uuid-1',
    ...overrides,
  };
}

/** The no-op socket client the app injects when `vite_socket_server` is empty. */
const deadSocket = (): ChatBoxHandlerDeps['emitSocket'] => () => false;

const noTransport: StreamStartOutcome = { started: false, reason: 'no-transport' };

describe('sendQuestion — a turn no transport accepted', () => {
  it('reports failure and shows the reason when the socket is the no-op stub', async () => {
    const history = makeHistory([]);
    const handlers = useChatBoxHandlers(makeDeps({
      setChatHistory: history.setChatHistory,
      emitSocket: deadSocket(),
      startStreamedExecution: () => Promise.resolve(noTransport),
    }));

    const result = await handlers.sendQuestion({ question: 'hi' });

    expect(result.success).toBe(false);
    const errors = history.read().filter((message) => message.exception !== undefined);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.role).toBe(ROLES.Assistant);
    expect(String(errors[0]?.exception)).toContain('was not sent');
  });

  it('keeps the turn silent-free but successful when the socket really delivers', async () => {
    const history = makeHistory([]);
    const emitSocket = vi.fn(() => true) as unknown as ChatBoxHandlerDeps['emitSocket'];
    const handlers = useChatBoxHandlers(makeDeps({
      setChatHistory: history.setChatHistory,
      emitSocket,
      startStreamedExecution: () => Promise.resolve(noTransport),
    }));

    const result = await handlers.sendQuestion({ question: 'hi' });

    expect(result.success).toBe(true);
    expect(history.read().some((message) => message.exception !== undefined)).toBe(false);
  });

  it('does not emit over the socket at all once the REST start owns the run', async () => {
    const history = makeHistory([]);
    const emitSocket = vi.fn(() => true) as unknown as ChatBoxHandlerDeps['emitSocket'];
    const handlers = useChatBoxHandlers(makeDeps({
      setChatHistory: history.setChatHistory,
      emitSocket,
      startStreamedExecution: () => Promise.resolve<StreamStartOutcome>({ started: true }),
    }));

    const result = await handlers.sendQuestion({ question: 'hi' });

    expect(result.success).toBe(true);
    expect(emitSocket).not.toHaveBeenCalled();
  });

  it('shows the route’s own reason and skips the socket when the start was rejected', async () => {
    const history = makeHistory([]);
    const emitSocket = vi.fn(() => true) as unknown as ChatBoxHandlerDeps['emitSocket'];
    const handlers = useChatBoxHandlers(makeDeps({
      setChatHistory: history.setChatHistory,
      emitSocket,
      startStreamedExecution: () => Promise.resolve<StreamStartOutcome>({ started: false, reason: 'rejected', message: 'No model is configured.' }),
    }));

    const result = await handlers.sendQuestion({ question: 'hi' });

    expect(result.success).toBe(false);
    expect(emitSocket).not.toHaveBeenCalled();
    expect(history.read().map((message) => message.exception)).toContain('No model is configured.');
  });

  it('reports failure rather than success when no conversation could be created', async () => {
    const history = makeHistory([]);
    const handlers = useChatBoxHandlers(makeDeps({
      setChatHistory: history.setChatHistory,
      conversationUuid: undefined,
      createConversation: () => Promise.resolve(undefined),
      startStreamedExecution: () => Promise.resolve(noTransport),
    }));

    const result = await handlers.sendQuestion({ question: 'hi' });

    expect(result.success).toBe(false);
    expect(history.read().some((message) => message.exception !== undefined)).toBe(true);
  });
});

const pausedMessage: ChatMessage = {
  id: 'answer-1',
  role: ROLES.Assistant,
  name: 'Agent',
  content: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  questionId: 'question-1',
  hitlInterrupt: { tool_call_id: 'call-1' },
};

describe('continueHitl — a resume no transport accepted', () => {
  it('puts the approval card back and stops the spinner', async () => {
    const history = makeHistory([pausedMessage]);
    const handlers = useChatBoxHandlers(makeDeps({
      setChatHistory: history.setChatHistory,
      chatHistory: [pausedMessage],
      emitSocket: deadSocket(),
    }));

    await handlers.continueHitl({ action: 'approve' });

    const restored = history.read()[0];
    expect(restored?.hitlInterrupt).toEqual({ tool_call_id: 'call-1' });
    expect(restored?.isLoading).toBe(false);
    expect(restored?.isStreaming).toBe(false);
    expect(String(restored?.exception)).toContain('was not sent');
  });

  it('keeps the optimistic patch when the emit really delivered', async () => {
    const history = makeHistory([pausedMessage]);
    const handlers = useChatBoxHandlers(makeDeps({
      setChatHistory: history.setChatHistory,
      chatHistory: [pausedMessage],
      emitSocket: () => true,
    }));

    await handlers.continueHitl({ action: 'approve' });

    const patched = history.read()[0];
    expect(patched?.hitlInterrupt).toBeUndefined();
    expect(patched?.isLoading).toBe(true);
    expect(patched?.exception).toBeUndefined();
  });
});

/**
 * DEFECT 3 — the resume never reached the backend that serves it.
 *
 * `continueHitl` emitted `chat_continue_predict` and nothing else, so on a
 * deployment with an empty `vite_socket_server` the approval went nowhere: the
 * run stayed paused server-side for good. The Go continuation route was
 * implemented, mounted and RBAC-gated the whole time, with no caller.
 */
interface ContinuationCall { readonly conversationUuid: string; readonly body: Record<string, unknown> }

/** Records every REST continuation and reports that the route accepted it. */
function captureContinuations(): {
  readonly calls: readonly ContinuationCall[];
  readonly continueStreamedExecution: NonNullable<ChatBoxHandlerDeps['continueStreamedExecution']>;
} {
  const calls: ContinuationCall[] = [];
  return {
    calls,
    continueStreamedExecution: (params) => {
      calls.push(params);
      return Promise.resolve<StreamStartOutcome>({ started: true });
    },
  };
}

describe('continueHitl — the REST continuation', () => {
  it('POSTs the route body and does not also emit on the socket', async () => {
    const history = makeHistory([pausedMessage]);
    const emitSocket = vi.fn(() => true);
    const seen = captureContinuations();
    const handlers = useChatBoxHandlers(makeDeps({
      setChatHistory: history.setChatHistory,
      chatHistory: [pausedMessage],
      emitSocket,
      continueStreamedExecution: seen.continueStreamedExecution,
    }));

    await handlers.continueHitl({ action: 'edit', value: 'do it differently' });

    expect(seen.calls).toHaveLength(1);
    // A second resume over the socket would run the agent twice.
    expect(emitSocket).not.toHaveBeenCalled();
    const call = seen.calls[0]!;
    expect(call.conversationUuid).toBe('conv-uuid-1');
    // `project_id` is a NUMBER for this route; the socket payload sends a string.
    expect(call.body['project_id']).toBe(1);
    expect(call.body['conversation_uuid']).toBe('conv-uuid-1');
    expect(call.body['message_id']).toBe('answer-1');
    expect(call.body['hitl_resume']).toBe(true);
    expect(call.body['hitl_action']).toBe('edit');
    expect(call.body['hitl_value']).toBe('do it differently');
    // The contract refuses these three alongside a HITL resume.
    expect(call.body['mcp_tokens']).toBeUndefined();
    expect(call.body['ignored_mcp_servers']).toBeUndefined();
    expect(call.body['hitl_decisions']).toBeUndefined();
  });

  it('falls back to the socket when the route refuses the resume', async () => {
    const history = makeHistory([pausedMessage]);
    const emitSocket = vi.fn(() => true);
    const handlers = useChatBoxHandlers(makeDeps({
      setChatHistory: history.setChatHistory,
      chatHistory: [pausedMessage],
      emitSocket,
      continueStreamedExecution: () => Promise.resolve(noTransport),
    }));

    await handlers.continueHitl({ action: 'approve' });

    expect(emitSocket).toHaveBeenCalledTimes(1);
    expect(history.read()[0]?.exception).toBeUndefined();
  });

  // A fan-out child decision needs an `interrupt_id`. `currentHITLDecisions`
  // refuses an entry without one, so a pause that carries none must not be
  // POSTed at all.
  it('sends a fan-out decision with its interrupt_id', async () => {
    const fanout: ChatMessage = {
      ...pausedMessage,
      hitlInterrupt: undefined,
      hitlInterrupts: [{ interrupt_id: 'int-9', tool_call_id: 'call-1' }],
    };
    const history = makeHistory([fanout]);
    const seen = captureContinuations();
    const handlers = useChatBoxHandlers(makeDeps({
      setChatHistory: history.setChatHistory,
      chatHistory: [fanout],
      continueStreamedExecution: seen.continueStreamedExecution,
    }));

    await handlers.continueHitl({ action: 'approve', toolCallId: 'call-1', childThreadId: 'thread-7' });

    const call = seen.calls[0]!;
    expect(call.body['thread_id']).toBe('thread-7');
    expect(call.body['hitl_decisions']).toEqual([
      { interrupt_id: 'int-9', tool_call_id: 'call-1', action: 'approve', value: '' },
    ]);
    // `thread_id` inside a decision entry is refused by the route.
    expect(call.body['hitl_action']).toBeUndefined();
  });

  it('stays on the socket for a fan-out decision with no interrupt_id', async () => {
    const fanout: ChatMessage = {
      ...pausedMessage,
      hitlInterrupt: undefined,
      hitlInterrupts: [{ tool_call_id: 'call-1' }],
    };
    const history = makeHistory([fanout]);
    const emitSocket = vi.fn(() => true);
    const seen = captureContinuations();
    const handlers = useChatBoxHandlers(makeDeps({
      setChatHistory: history.setChatHistory,
      chatHistory: [fanout],
      emitSocket,
      continueStreamedExecution: seen.continueStreamedExecution,
    }));

    await handlers.continueHitl({ action: 'approve', toolCallId: 'call-1', childThreadId: 'thread-7' });

    expect(seen.calls).toHaveLength(0);
    expect(emitSocket).toHaveBeenCalledTimes(1);
  });
});

describe('continueTokenLimit / resumeMcpFlow — the same silent stub', () => {
  const tokenLimitMessage: ChatMessage = { ...pausedMessage, hitlInterrupt: undefined, requiresConfirmation: { message: 'Continue?', buttonText: 'Continue' } };

  it('continueTokenLimit reverts its own spinner', () => {
    const history = makeHistory([tokenLimitMessage]);
    const handlers = useChatBoxHandlers(makeDeps({
      setChatHistory: history.setChatHistory,
      chatHistory: [tokenLimitMessage],
      emitSocket: deadSocket(),
    }));

    handlers.continueTokenLimit('answer-1');

    expect(history.read()[0]?.isLoading).toBe(false);
    expect(history.read()[0]?.exception).toBeDefined();
  });

  it('resumeMcpFlow reverts its own spinner', () => {
    const history = makeHistory([tokenLimitMessage]);
    const handlers = useChatBoxHandlers(makeDeps({
      setChatHistory: history.setChatHistory,
      chatHistory: [tokenLimitMessage],
      emitSocket: deadSocket(),
    }));

    handlers.resumeMcpFlow('answer-1');

    expect(history.read()[0]?.isStreaming).toBe(false);
    expect(history.read()[0]?.exception).toBeDefined();
  });
});
