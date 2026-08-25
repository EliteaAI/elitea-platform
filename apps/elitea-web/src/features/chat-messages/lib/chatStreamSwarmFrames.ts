/**
 * lib/chatStreamSwarmFrames.ts — the swarm family.
 *
 * Owns `swarm_child_message` — the one swarm frame that writes state — and the
 * three raw `agent_swarm_*` lifecycle frames that are state-inert on purpose,
 * kept here beside it so the reason they write nothing sits next to the case
 * that does. Its own file for the §3.5 file-length budget and nothing else; the
 * cases, the parent lookup and the content flattening are unchanged.
 */
import { convertJsonToString } from '@/shared/lib/json';
import { convertTime } from '@/entities/message/lib/normalise';
import { TOOL_ACTION_TYPES, ToolActionStatus } from '@/shared/lib/chat';

import { nowIso, replaceAt, type ChatStreamContext, type ToolAction } from './chatStreamShared';

import type { ChatMessage } from './convertMessagesToChatHistory';
import { SocketMessageType, type ChatStreamFrame } from './chatStreamFrame';

/**
 * The text a swarm child actually said.
 *
 * The backend sends Anthropic-format content blocks, so `content` is a string,
 * an array mixing `{text}` blocks with `{type: 'tool_use'}` blocks, or a bare
 * object. Only the text survives: a tool_use block has no prose to show, and
 * stringifying one would put raw JSON in the sub-agent accordion.
 */
function swarmChildText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => typeof block === 'string' || (block as { text?: unknown } | null)?.text)
      .map((block) => (typeof block === 'string' ? block : String((block as { text: unknown }).text)))
      .join('\n');
  }
  if (content && typeof content === 'object') {
    const text = (content as { text?: unknown }).text;
    return typeof text === 'string' ? text : convertJsonToString(content);
  }
  return '';
}

/**
 * The message a swarm child's output belongs to.
 *
 * NOT `findTarget`: on this frame `message_id` is the CHILD's id, so the usual
 * lookup would miss and the child's answer would be dropped. The baseline
 * resolves `parent_message_id` and falls back to whichever message is still in
 * flight — a child can report before its parent's id has propagated, and losing
 * a sub-agent's whole answer is worse than attaching it to the turn in progress.
 */
function findSwarmParent(history: readonly ChatMessage[], frame: ChatStreamFrame): number {
  const parentId = frame.parent_message_id;
  if (parentId) {
    const byId = history.findIndex((message) => message.id === parentId);
    if (byId !== -1) return byId;
  }
  return history.findIndex((message) => message.isStreaming || message.isLoading);
}

/**
 * Reduce one swarm frame, or return `undefined` for a frame this family does
 * not own so the dispatcher can offer it to the next one.
 *
 * `index` is deliberately NOT a parameter: this family resolves its own target
 * through `findSwarmParent`, for the reason that function's doc gives.
 */
export function reduceSwarmFrame(
  history: readonly ChatMessage[],
  frame: ChatStreamFrame,
  type: string,
  context: ChatStreamContext,
): readonly ChatMessage[] | undefined {
  switch (type) {
    // A swarm sub-agent finished and reported its answer. It lands as a tool
    // action on the PARENT's message, which the renderer pulls out by type and
    // shows as its own accordion (`ApplicationAnswer.tsx:161-166`).
    //
    // The shape is the baseline's LIVE one, which is not quite the persisted
    // one `convertMessagesToChatHistory.buildSwarmChildAction` produces: that
    // adds `isSwarmChild`/`agentName` and defaults a missing name to
    // "Child Agent", where an unnamed live child falls through to the
    // renderer's own "Sub-agent". The divergence is the baseline's, so it is
    // reproduced rather than quietly reconciled — the two paths are compared
    // side by side on the same conversation, and inventing a third shape here
    // would make a replayed swarm turn differ from the one just watched.
    case SocketMessageType.SwarmChildMessage: {
      const text = swarmChildText(frame.content);
      // A tool_use-only message has nothing to say; adding it would put an
      // empty accordion in the timeline for every tool the child called.
      if (!text.trim()) return history;

      const parentIndex = findSwarmParent(history, frame);
      if (parentIndex === -1) return history;
      const parent = history[parentIndex];
      if (!parent) return history;

      const createdAt = frame.created_at;
      const at =
        typeof createdAt === 'string'
          ? new Date(convertTime(createdAt)).getTime()
          : typeof createdAt === 'number'
            ? createdAt
            : Date.parse(nowIso(context));
      const agentName = frame.agent_name ?? '';

      const draft: Record<string, unknown> = {
        id: frame.message_id ?? crypto.randomUUID(),
        name: agentName,
        status: ToolActionStatus.complete,
        toolInputs: '',
        toolOutputs: text,
        toolMeta: { agent_name: agentName },
        created_at: at,
        ended_at: at,
        timestamp: at,
        content: text,
        type: TOOL_ACTION_TYPES.SwarmChild,
        markdown: true,
      };

      return replaceAt(history, parentIndex, {
        toolActions: [...((parent.toolActions ?? []) as readonly ToolAction[]), draft as unknown as ToolAction],
      });
    }

    // The raw swarm lifecycle. State-inert on purpose, and NOT forwarded
    // either: the baseline's comment is explicit that the UI renders swarm work
    // from swarm_child_message alone, so these three would be a second, partial
    // source for the same accordions.
    case SocketMessageType.AgentSwarmAgentStart:
    case SocketMessageType.AgentSwarmAgentResponse:
    case SocketMessageType.AgentSwarmHandoff:
      return history;

    default:
      return undefined;
  }
}
