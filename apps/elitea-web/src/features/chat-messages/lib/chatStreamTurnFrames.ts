/**
 * lib/chatStreamTurnFrames.ts — the turn-lifecycle family.
 *
 * Owns everything that moves the assistant bubble itself through a turn:
 * `start_task`/`agent_start`, `agent_llm_start`, the three chunk flavours,
 * `agent_llm_end` (including its end-of-turn `thinking_steps` fan-out),
 * `agent_response`, `references`, `pipeline_finish` and the three failure
 * frames. It is a separate file because `chatStreamReducer.ts` was 1,181 lines
 * and §3.5 caps a file at 400 with no warning tier — that is the whole reason;
 * the cases and their comments are the originals, moved unchanged.
 */
import { convertJsonToString } from '@/shared/lib/json';
import { ToolActionStatus } from '@/shared/lib/chat';

import { applyThinkingStep, isEmptyTransition } from './chatStreamThinkingFrames';
import {
  createAssistantMessage,
  replaceAt,
  threadIdOf,
  type ChatStreamContext,
  type ToolAction,
} from './chatStreamShared';

import type { ChatMessage } from './convertMessagesToChatHistory';
import { SocketMessageType, type ChatStreamFrame } from './chatStreamFrame';

/** The frame's text, in the baseline's two flavours: fenced for whole responses, raw for chunks. */
function frameText(frame: ChatStreamFrame, inBlock: boolean): string {
  if (frame.content === undefined || frame.content === null) return '';
  return convertJsonToString(frame.content, inBlock);
}

/**
 * A turn is finished when the model reports why it stopped. The baseline gates
 * on `response_metadata.finish_reason` for exactly this
 * (hooks.js AgentResponse), rather than on the frame type, because a response
 * frame also arrives mid-turn for intermediate agent output.
 */
function isFinalResponse(frame: ChatStreamFrame): boolean {
  return Boolean(frame.response_metadata?.finish_reason);
}

/**
 * Reduce one turn-lifecycle frame, or return `undefined` for a frame this
 * family does not own so the dispatcher can offer it to the next one.
 */
export function reduceTurnFrame(
  history: readonly ChatMessage[],
  frame: ChatStreamFrame,
  type: string,
  context: ChatStreamContext,
  index: number,
): readonly ChatMessage[] | undefined {
  switch (type) {
    // The turn begins. The baseline resets content here unless it is resuming a
    // continuation, so a regenerate does not append to the previous answer.
    case SocketMessageType.StartTask:
    case SocketMessageType.AgentStart: {
      if (index === -1) return [...history, createAssistantMessage(frame, context)];
      const current = history[index];
      if (!current) return history;
      const continuingOutput = frame.response_metadata?.should_continue === true;
      return replaceAt(history, index, {
        content: continuingOutput ? current.content : '',
        isStreaming: true,
        isLoading: true,
        references: continuingOutput ? current.references : [],
        exception: undefined,
        requiresConfirmation: undefined,
        ...(frame.question_id !== undefined ? { questionId: frame.question_id } : {}),
      });
    }

    // The model started producing. No content yet; this only flips the spinner
    // for a message that may not exist until the first chunk arrives.
    case SocketMessageType.AgentLlmStart: {
      if (index === -1) return [...history, createAssistantMessage(frame, context)];
      return replaceAt(history, index, { isStreaming: true, isLoading: true });
    }

    // The three chunk flavours are one behaviour: append the delta.
    case SocketMessageType.AgentLlmChunk:
    case SocketMessageType.Chunk:
    case SocketMessageType.AIMessageChunk: {
      const delta = frameText(frame, false);
      if (!delta) return history;
      if (index === -1) {
        const created = createAssistantMessage(frame, context);
        return [...history, { ...created, content: delta }];
      }
      const current = history[index];
      if (!current) return history;
      return replaceAt(history, index, {
        content: current.content + delta,
        isStreaming: true,
        // FALSE once a token exists, and this is what makes streaming visible:
        // `ApplicationAnswer` gates the answer body on
        // `canRenderContent = !exception && !isLoadingOrRegenerating`, so while
        // `isLoading` is true the accumulated text is held back and the whole
        // reply appears in one step when the turn settles — measured, with the
        // mock slowed to 400ms per chunk (#294).
        //
        // `isLoading` means "waiting for output"; a delta IS output. The
        // processing affordances do not disappear, because `isProcessing` also
        // reads `isStreaming`, which stays true until the turn ends.
        //
        // DEVIATION, stated: the baseline's chunk case does not write
        // `msg.content` at all — it appends each delta to the LLM tool action
        // and lets `agent_response` fill the bubble at the end, so its bubble
        // never streams either and the live feedback is the thinking view.
        // This port streams the answer itself, which is why it also has to
        // suppress the duplicate `agent_response` append below.
        isLoading: false,
      });
    }

    // The model finished emitting tokens. Streaming stops; the turn is not
    // necessarily over (agent_response and pipeline_finish still follow).
    //
    // This frame also carries the `thinking_steps` fan-out: one batch closing
    // out every step reported live. A pipeline with several LLM nodes reports
    // them all here, which is why this loops rather than handling a single id.
    case SocketMessageType.AgentLlmEnd: {
      if (index === -1) return history;
      const current = history[index];
      if (!current) return history;

      const steps = frame.response_metadata?.thinking_steps ?? [];
      const actions = (current.toolActions ?? []) as readonly ToolAction[];
      const removed = new Set<string>();
      let next = actions;

      for (const step of steps) {
        // The normalised id, with the baseline's backward-compatible fallback
        // for providers that only echoed it inside the message id.
        const stepRunId = step.tool_run_id ?? step.message?.id?.replace('lc_run--', '');
        if (!stepRunId) continue;
        const target = next.find((action) => action.id === stepRunId);
        if (!target) continue;
        const updated = applyThinkingStep(target, step);
        if (isEmptyTransition(updated)) {
          removed.add(stepRunId);
          continue;
        }
        next = next.map((action) =>
          action.id === stepRunId ? ({ ...updated, status: ToolActionStatus.complete } as ToolAction) : action,
        );
      }

      // The frame's own tool_run_id closes too, unless something already
      // settled it or it is waiting on the user.
      const primaryId = frame.response_metadata?.tool_run_id;
      if (primaryId) {
        next = next.map((action) =>
          action.id === primaryId &&
          action.status !== ToolActionStatus.complete &&
          action.status !== ToolActionStatus.actionRequired
            ? ({ ...action, status: ToolActionStatus.complete, ended_at: frame.created_at } as ToolAction)
            : action,
        );
      }

      if (removed.size > 0) next = next.filter((action) => !removed.has(action.id));
      const unchanged = next === actions;
      return replaceAt(history, index, { isLoading: false, ...(unchanged ? {} : { toolActions: next }) });
    }

    // A whole response, fenced when it is not plain text. It carries the
    // terminal signal for a chat turn.
    //
    // `freeform` is NOT handled here despite the similar name. Reading the
    // baseline's graph slice turned up that its `freeform` case is a bare
    // `break` (hooks.js:1393-1394) — it appends nothing and forwards nothing —
    // and an earlier slice of this port had paired the two. Neither the Go
    // services nor the Python worker's event map emits `freeform` at all, so
    // the pairing was inert in practice, but appending on a frame the baseline
    // ignores is a content duplication waiting for whoever revives the type.
    case SocketMessageType.AgentResponse: {
      const text = frameText(frame, true);
      if (index === -1) {
        if (!text) return history;
        const created = createAssistantMessage(frame, context);
        return [...history, { ...created, content: text }];
      }
      const current = history[index];
      if (!current) return history;
      const finished = isFinalResponse(frame);
      const threadId = threadIdOf(frame);
      // `agent_response` carries the WHOLE reply, and on this backend it
      // arrives AFTER the `agent_llm_chunk` frames that already assembled the
      // same text — measured against a live stack:
      //
      //   agent_llm_chunk "MOCK: " → "dbg " → "1786… "
      //   agent_llm_end → partial_message → pipeline_finish
      //   agent_response "MOCK: dbg 1786… "     ← the whole thing again
      //
      // Appending unconditionally (as the baseline does, `msg.content +=`)
      // therefore renders every answer TWICE. The baseline gets away with it
      // because pylon sent one or the other, never both.
      //
      // Gated on what is ALREADY THERE rather than on the frame type: a
      // pipeline emitting several distinct intermediate responses still
      // appends each of them, because none of those is a repeat of the tail.
      const alreadyRendered = text !== '' && current.content.endsWith(text);
      return replaceAt(history, index, {
        content: alreadyRendered ? current.content : current.content + text,
        ...(finished ? { isStreaming: false, isLoading: false, hitlInterrupt: undefined, hitlInterrupts: undefined } : {}),
        ...(finished && threadId !== undefined ? { threadId } : {}),
      });
    }

    case SocketMessageType.References: {
      if (index === -1 || !frame.references) return history;
      return replaceAt(history, index, { references: frame.references });
    }

    // Terminal for the whole execution, including pipelines whose last frame is
    // not an agent_response.
    case SocketMessageType.PipelineFinish: {
      if (index === -1) return history;
      return replaceAt(history, index, { isStreaming: false, isLoading: false });
    }

    // Failures stop the turn and surface on the message. `content` is left
    // alone: whatever streamed before the error is what the user saw, and
    // discarding it would hide how far the run got.
    case SocketMessageType.Error:
    case SocketMessageType.LlmError:
    case SocketMessageType.AgentException: {
      const exception = frame.content ?? frame['exception'] ?? type;
      if (index === -1) {
        const created = createAssistantMessage(frame, context);
        return [...history, { ...created, isStreaming: false, isLoading: false, exception }];
      }
      return replaceAt(history, index, { isStreaming: false, isLoading: false, exception });
    }

    default:
      return undefined;
  }
}
