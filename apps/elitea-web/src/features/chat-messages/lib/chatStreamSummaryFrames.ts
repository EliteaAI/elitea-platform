/**
 * lib/chatStreamSummaryFrames.ts — the history-summarisation family.
 *
 * Owns `chat_predict_summary_started`/`chat_predict_summary_finished`: the pair
 * that puts a "Summarizing the chat history…" entry on the timeline and closes
 * it again. Split off `chatStreamReducer.ts` because that file broke the §3.5
 * 400-line budget — that is the only reason, and the two cases plus every
 * comment on them are moved verbatim.
 */
import { TOOL_ACTION_NAMES, TOOL_ACTION_TYPES, ToolActionStatus } from '@/shared/lib/chat';

import { createAssistantMessage, nowIso, replaceAt, type ChatStreamContext, type ToolAction } from './chatStreamShared';

import type { ChatMessage } from './convertMessagesToChatHistory';
import { SocketMessageType, type ChatStreamFrame } from './chatStreamFrame';

/**
 * Reduce one summarisation frame, or return `undefined` for a frame this family
 * does not own so the dispatcher can offer it to the next one.
 */
export function reduceSummaryFrame(
  history: readonly ChatMessage[],
  frame: ChatStreamFrame,
  type: string,
  context: ChatStreamContext,
  index: number,
): readonly ChatMessage[] | undefined {
  switch (type) {
    // The history got long enough that the backend is summarising it before it
    // can answer. This is a RESUMPTION, not a new turn: it clears the previous
    // answer and every pause left over from it, so a summary that follows an
    // approval does not leave a stale card the user could still click.
    case SocketMessageType.ChatPredictSummaryStarted: {
      // The run id and model live on `payload`, not `response_metadata`.
      const runId = frame.payload?.response_metadata?.tool_run_id;
      const summary: Record<string, unknown> = {
        name: TOOL_ACTION_NAMES.Summary,
        // Same precedence bug as the thinking-step case in the baseline
        // (`'thinking_step_' + id || '' + v4()` is always truthy, so the uuid
        // never ran and every id-less summary collided). The intent is a
        // unique id, which is what this does.
        id: `thinking_step_${runId ?? crypto.randomUUID()}`,
        status: ToolActionStatus.processing,
        toolInputs: undefined,
        toolOutputs: undefined,
        toolMeta: { ls_model_name: frame.payload?.llm_settings?.model_name ?? '' },
        created_at: Date.parse(nowIso(context)),
        type: TOOL_ACTION_TYPES.Summary,
        markdown: true,
        renderHtml: false,
        message: 'Summarizing the chat history...',
        content: '',
      };

      const reset: Partial<ChatMessage> = {
        isLoading: true,
        isStreaming: true,
        // `undefined`, not `false`, as the baseline writes it — the two are the
        // same to `isMessageInFlight`, and diverging here would be an invented
        // difference between a resumed turn and a fresh one.
        isRegenerating: undefined,
        content: '',
        references: [],
        requiresConfirmation: undefined,
        hitlInterrupt: undefined,
        hitlInterrupts: undefined,
        ...(frame.task_id !== undefined ? { taskId: frame.task_id } : {}),
        ...(frame.question_id !== undefined ? { questionId: frame.question_id } : {}),
        ...(context.participantId !== undefined ? { participantId: context.participantId } : {}),
      };

      if (index === -1) {
        const created = createAssistantMessage(frame, context);
        return [...history, { ...created, ...reset, toolActions: [summary as unknown as ToolAction] }];
      }
      const current = history[index];
      if (!current) return history;
      return replaceAt(history, index, {
        ...reset,
        // DEVIATION: the baseline copies the whole question message onto
        // `msg.replyTo`. This app models the link as an id (`replyToId`), so
        // the id is what gets written — carrying a snapshot of another message
        // would be a second copy of state that goes stale on edit.
        ...(current.replyToId === undefined && frame.question_id !== undefined
          ? { replyToId: frame.question_id }
          : {}),
        toolActions: [...((current.toolActions ?? []) as readonly ToolAction[]), summary as unknown as ToolAction],
      });
    }

    // Summarising finished. Closes the entry by TYPE and status rather than by
    // id: the finish frame carries no run id at all, so an id lookup would
    // leave the summary spinning for the rest of the conversation.
    case SocketMessageType.ChatPredictSummaryFinished: {
      if (index === -1) return history;
      const current = history[index];
      if (!current) return history;
      const actions = (current.toolActions ?? []) as readonly ToolAction[];
      const target = actions.find(
        (action) => action['type'] === TOOL_ACTION_TYPES.Summary && action.status === ToolActionStatus.processing,
      );
      if (!target) return history;

      return replaceAt(history, index, {
        toolActions: actions.map((action) =>
          action === target
            ? ({
                ...action,
                // The status line is cleared when the tool ends, the same way
                // the tool-end case clears it.
                message: undefined,
                content: '',
                status: ToolActionStatus.complete,
                ended_at: Date.parse(nowIso(context)),
              } as ToolAction)
            : action,
        ),
      });
    }

    default:
      return undefined;
  }
}
