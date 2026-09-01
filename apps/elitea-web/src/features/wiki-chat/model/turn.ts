/**
 * Opening and abandoning a turn — the half of the conversation the STREAM does
 * not drive.
 *
 * The reducer next door owns every frame that arrives. This owns the two
 * transitions that happen without one: the user asks a question, and the
 * request fails before any frame is produced. Both were inline inside the
 * legacy `handleSend`, tangled with the payload construction and the socket
 * emit, which is why neither could be tested.
 *
 * Pure, and separate from the hook for that reason.
 */
import type { ChatCapability, ChatMessage, ChatState, ChatTurn } from './types';
import { isThinkingBlock } from './types';

/** How many turns of history the question carries. */
const CHAT_HISTORY_TURNS = 6;

export interface OpenTurnInput {
  readonly question: string;
  readonly capability: ChatCapability;
  /** The thinking block's id. Supplied so the caller owns id generation. */
  readonly blockId: string;
  readonly streamId: string;
  readonly messageId: string;
}

/**
 * Add the question and open a thinking block for the answer.
 *
 * The todos are RESET here rather than when the first one arrives. A research
 * run that produces no plan would otherwise show the previous run's, which
 * reads as a plan for the question just asked.
 */
export function openTurn(state: ChatState, input: OpenTurnInput): ChatState {
  return {
    ...state,
    messages: [
      ...state.messages,
      { role: 'user', content: input.question, capability: input.capability },
      { type: 'thinking_steps', id: input.blockId, status: 'running', steps: [] },
    ],
    todos: [],
    activeBlockId: input.blockId,
    pendingCapability: input.capability,
    streamId: input.streamId,
    messageId: input.messageId,
    isLoading: true,
    error: null,
    // A new question starts with no answer. Carrying the previous turn's
    // streamed text would show it under the new question as though the model
    // had already begun answering it.
    streamingText: '',
  };
}

/**
 * The request never started: REMOVE the block, then report the failure.
 *
 * Removing rather than completing it is the point. A block left behind would
 * be an empty "thinking" panel under a question that was never asked, and the
 * user cannot tell that from a run that thought about nothing.
 */
export function failTurn(state: ChatState, blockId: string, message: string): ChatState {
  const capability = state.pendingCapability ?? 'ask';
  const withoutBlock = state.messages.filter(
    (entry) => !(isThinkingBlock(entry) && entry.id === blockId),
  );

  return {
    ...state,
    messages: [
      ...withoutBlock,
      {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${message}`,
        isError: true,
        capability,
      },
    ],
    activeBlockId: null,
    pendingCapability: null,
    streamId: null,
    messageId: null,
    mode: capability,
    isLoading: false,
    error: message,
  };
}

/**
 * The last six turns, as the provider expects them.
 *
 * Thinking blocks are excluded: they are this screen's rendering of a run, not
 * anything the model said. Sending them would feed the model its own progress
 * log as conversation.
 */
export function chatHistory(
  messages: readonly ChatMessage[],
): readonly { role: 'user' | 'assistant'; content: string }[] {
  return messages
    .filter((entry): entry is ChatTurn => !isThinkingBlock(entry) && typeof entry.content === 'string')
    .slice(-CHAT_HISTORY_TURNS)
    .map((entry) => ({ role: entry.role, content: entry.content }));
}

/** Which provider tool answers for each capability. */
export function toolNameFor(capability: ChatCapability): string {
  return capability === 'research' ? 'deep_research' : 'ask';
}

/**
 * The capability the drawer should open in.
 *
 * The LAST ANSWER wins over the persisted toggle, because the toggle records an
 * intention and the answer records what happened. Reopening in `research` after
 * the last run fell back to `ask` would label the next question with a mode the
 * user did not choose.
 */
export function capabilityOnOpen(
  messages: readonly ChatMessage[],
  persisted: ChatCapability | null,
): ChatCapability | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (
      entry &&
      !isThinkingBlock(entry) &&
      entry.role === 'assistant' &&
      (entry.capability === 'ask' || entry.capability === 'research')
    ) {
      return entry.capability;
    }
  }
  return persisted;
}

/**
 * The question to re-ask, and the messages to re-ask it from.
 *
 * Regenerating REMOVES everything after the last question rather than appending
 * a second answer, so the conversation the model is given does not contain the
 * answer it is being asked to replace.
 */
export function rewindToLastQuestion(
  messages: readonly ChatMessage[],
): { question: string; messages: readonly ChatMessage[] } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (entry && !isThinkingBlock(entry) && entry.role === 'user') {
      return { question: entry.content, messages: messages.slice(0, index) };
    }
  }
  return null;
}
