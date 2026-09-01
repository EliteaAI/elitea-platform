import { describe, expect, it } from 'vitest';

import {
  capabilityOnOpen,
  chatHistory,
  failTurn,
  openTurn,
  rewindToLastQuestion,
  toolNameFor,
} from './turn';
import { initialChatState, isThinkingBlock, type ChatMessage, type ChatState } from './types';

const OPEN = {
  question: 'Where is the router?',
  capability: 'ask',
  blockId: 'block-1',
  streamId: 'stream-1',
  messageId: 'message-1',
} as const;

describe('openTurn', () => {
  it('appends the question and opens a block for the answer', () => {
    const state = openTurn(initialChatState, OPEN);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toEqual({
      role: 'user',
      content: 'Where is the router?',
      capability: 'ask',
    });
    expect(state.messages[1]).toMatchObject({ type: 'thinking_steps', status: 'running', steps: [] });
    expect(state.activeBlockId).toBe('block-1');
    expect(state.pendingCapability).toBe('ask');
    expect(state.isLoading).toBe(true);
  });

  it('resets the todos, so a new question does not inherit the last plan', () => {
    const withTodos: ChatState = { ...initialChatState, todos: [{ id: 1, title: 'old' }] };
    expect(openTurn(withTodos, OPEN).todos).toEqual([]);
  });

  it('clears a previous error', () => {
    const failed: ChatState = { ...initialChatState, error: 'the last one broke' };
    expect(openTurn(failed, OPEN).error).toBeNull();
  });
});

describe('failTurn', () => {
  it('REMOVES the block rather than completing it', () => {
    // A completed-but-empty thinking panel under a question that never ran is
    // indistinguishable from a run that thought about nothing.
    const opened = openTurn(initialChatState, OPEN);
    const failed = failTurn(opened, 'block-1', 'no toolkit');

    expect(failed.messages.filter(isThinkingBlock)).toHaveLength(0);
    expect(failed.messages.at(-1)).toMatchObject({
      role: 'assistant',
      isError: true,
      content: 'Sorry, I encountered an error: no toolkit',
    });
  });

  it('leaves any OTHER block alone', () => {
    const first = openTurn(initialChatState, OPEN);
    const second = openTurn(first, { ...OPEN, blockId: 'block-2' });
    const failed = failTurn(second, 'block-2', 'broke');

    expect(failed.messages.filter(isThinkingBlock).map((block) => block.id)).toEqual(['block-1']);
  });

  it('settles the turn so the next question is accepted', () => {
    const failed = failTurn(openTurn(initialChatState, OPEN), 'block-1', 'broke');
    expect(failed.isLoading).toBe(false);
    expect(failed.streamId).toBeNull();
    expect(failed.pendingCapability).toBeNull();
    expect(failed.error).toBe('broke');
  });

  it('labels the failure with the capability that was in flight', () => {
    const opened = openTurn(initialChatState, { ...OPEN, capability: 'research' });
    expect(failTurn(opened, 'block-1', 'broke').messages.at(-1)).toMatchObject({
      capability: 'research',
    });
  });
});

describe('chatHistory', () => {
  it('excludes thinking blocks, which are this screen and not the conversation', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'one' },
      { type: 'thinking_steps', id: 'b', status: 'completed', steps: [] },
      { role: 'assistant', content: 'two' },
    ];
    expect(chatHistory(messages)).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
    ]);
  });

  it('keeps the last six turns', () => {
    const messages: ChatMessage[] = Array.from({ length: 10 }, (_unused, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${index}`,
    }));
    const history = chatHistory(messages);
    expect(history).toHaveLength(6);
    expect(history[0]?.content).toBe('turn 4');
    expect(history.at(-1)?.content).toBe('turn 9');
  });
});

describe('toolNameFor', () => {
  it('maps the capability to the provider tool', () => {
    expect(toolNameFor('ask')).toBe('ask');
    expect(toolNameFor('research')).toBe('deep_research');
  });
});

describe('capabilityOnOpen', () => {
  it('prefers the LAST ANSWER over the persisted toggle', () => {
    // The toggle records an intention; the answer records what happened. A run
    // that fell back to `ask` must not reopen labelled `research`.
    const messages: ChatMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a', capability: 'ask' },
    ];
    expect(capabilityOnOpen(messages, 'research')).toBe('ask');
  });

  it('falls back to the persisted toggle when nothing has answered', () => {
    expect(capabilityOnOpen([], 'research')).toBe('research');
    expect(capabilityOnOpen([{ role: 'user', content: 'q' }], 'research')).toBe('research');
  });

  it('ignores an answer that carries no capability', () => {
    expect(capabilityOnOpen([{ role: 'assistant', content: 'a' }], null)).toBeNull();
  });
});

describe('rewindToLastQuestion', () => {
  it('drops everything from the question onward', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second' },
      { type: 'thinking_steps', id: 'b', status: 'completed', steps: [] },
      { role: 'assistant', content: 'a bad answer' },
    ];
    const rewound = rewindToLastQuestion(messages);
    expect(rewound?.question).toBe('second');
    // The bad answer is GONE: regenerating with it still in history would show
    // the model the answer it is being asked to replace.
    expect(rewound?.messages).toEqual(messages.slice(0, 2));
  });

  it('reports nothing to regenerate when no question was asked', () => {
    expect(rewindToLastQuestion([])).toBeNull();
    expect(rewindToLastQuestion([{ role: 'assistant', content: 'hello' }])).toBeNull();
  });
});
