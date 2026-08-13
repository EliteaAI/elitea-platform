/**
 * lib/chatStreamReducer.ts — the chat streaming reducer (issue #93, Surface B).
 *
 * PORT STATUS — COMPLETE. The baseline reducer is
 * `EliteaUI/src/components/Chat/hooks.js:391-1581`: 1,191 lines, 34 switch
 * cases. Every one of them is now accounted for, across seven slices: core
 * streaming, the tool lifecycle, thinking steps, interrupts, graph events,
 * swarm, and summaries. The sequence a live stack actually emits is:
 *
 *   agent_start → agent_on_transitional_edge → agent_llm_start
 *     → agent_llm_chunk* → agent_llm_end → agent_response
 *     → partial_message → full_message → pipeline_finish
 *
 * STATE-INERT BY DESIGN, which is a different thing from unported: the
 * `agent_on_*` graph frames drive the pipeline flow editor's node highlighting
 * and touch no message at all — the baseline's five case labels contain nothing
 * but the forward call. They fall through to `default` here on purpose, and
 * `agentGraphEvents.shouldForwardAgentEvent` carries the half a caller owes
 * them. `freeform` is inert for the same reason: the baseline's case is a bare
 * `break`, and the three raw `agent_swarm_*` frames are inert because the
 * baseline says outright that swarm work renders from `swarm_child_message`
 * alone.
 *
 * SIDE EFFECTS ARE NOT PORTED, and that is a boundary rather than an omission.
 * The baseline's tool cases also fire Google Analytics events, write
 * `window.__lastToolMetaFull`, and call `McpAuthHelpers.setSessionId` when a
 * tool reports an MCP session. A pure reducer cannot do any of that. The
 * metadata those effects read is preserved verbatim on `toolMeta`, so the hook
 * that eventually drives this reducer can perform them from the same frame —
 * see `mcpSessionFromFrame`, which extracts exactly that pair for a caller.
 *
 * SHAPE DEVIATION from the baseline, applied throughout: the baseline MUTATES a
 * message object and calls `setChatHistory` for its side effects, reading refs
 * for participants and the active participant. `ChatMessage` here is deeply
 * readonly, so this is a pure `(state, frame) => state` reducer — no refs, no
 * hooks, no I/O. That is what makes it testable against recorded frames without
 * a socket, a server, or a React tree, and it is why the port is worth doing
 * before the transport swap rather than after.
 */
import { convertJsonToString } from '@/shared/lib/json';
import { convertTime } from '@/entities/message/lib/normalise';
import { ROLES } from '@/shared/lib/enums';
import { TOOL_ACTION_NAMES, TOOL_ACTION_TYPES, ToolActionStatus } from '@/shared/lib/chat';

import { normalizeExecutionHierarchy } from './executionHierarchy';
import { mergeHitlInterrupts, normalizeHitlInterrupt, type NormalizedHitlInterrupt } from './hitlInterrupts';

import type { SubAgentGroupable } from '@/entities/message/lib/subAgentGrouping';
import type { MessageParticipantWire } from '@/entities/message/lib/wire';

import type { ChatMessage } from './convertMessagesToChatHistory';
import { SocketMessageType, type ChatStreamFrame, type ThinkingStep } from './chatStreamFrame';

/** Caller-supplied identity for messages this reducer has to create. */
export interface ChatStreamContext {
  /** Participant the answer is attributed to, when the frame does not say. */
  readonly participantId?: string | undefined;
  /** Display name for a newly created assistant message. */
  readonly name?: string | undefined;
  /** Avatar for a newly created assistant message. */
  readonly avatar?: string | undefined;
  /** Injectable clock so tests do not depend on wall time. */
  readonly now?: () => string;
  /**
   * Whether the surface is in single-agent ("mono") chat.
   *
   * The baseline reads `isMonoChattingRef.current` when a turn stops on the
   * token limit: in mono chat the message keeps streaming (the continue button
   * resumes the same bubble), while in a multi-participant conversation it must
   * stop so the next participant can take the floor. A pure reducer has no
   * refs, so the caller supplies it.
   */
  readonly isMonoChatting?: boolean | undefined;
  /**
   * The conversation's participants, for `chat_user_message` to attribute an
   * echoed question to its author.
   *
   * The baseline reads `participantsRef.current`. A pure reducer has no refs,
   * and this is the only case that needs the roster — every other frame either
   * carries its own identity or falls back to `context.name`.
   */
  readonly participants?: readonly MessageParticipantWire[] | undefined;
}

function nowIso(context: ChatStreamContext): string {
  return context.now ? context.now() : new Date().toISOString();
}

/**
 * Resolve the assistant message a frame belongs to.
 *
 * By `message_id` first, then by `questionId` — the baseline's `getMessage`
 * does the same (hooks.js:391-404) because the two identifiers arrive in
 * different frames: `start_task` names the question it answers before the
 * assistant message has an id of its own.
 */
function findTarget(history: readonly ChatMessage[], frame: ChatStreamFrame): number {
  const messageId = frame.message_id;
  if (messageId) {
    const byId = history.findIndex((message) => message.id === messageId);
    if (byId !== -1) return byId;
  }
  const questionId = frame.question_id;
  if (questionId) {
    return history.findIndex(
      (message) => message.questionId === questionId && message.role === ROLES.Assistant,
    );
  }
  return -1;
}

/** A fresh assistant message for a frame that names one we have never seen. */
function createAssistantMessage(frame: ChatStreamFrame, context: ChatStreamContext): ChatMessage {
  return {
    id: frame.message_id ?? crypto.randomUUID(),
    role: ROLES.Assistant,
    name: context.name ?? '',
    content: '',
    createdAt: nowIso(context),
    isStreaming: true,
    isLoading: true,
    ...(frame.question_id !== undefined ? { questionId: frame.question_id } : {}),
    ...(context.participantId !== undefined ? { participantId: context.participantId } : {}),
    ...(context.avatar !== undefined ? { avatar: context.avatar } : {}),
  };
}

function replaceAt(
  history: readonly ChatMessage[],
  index: number,
  update: Partial<ChatMessage>,
): readonly ChatMessage[] {
  return history.map((message, position) => (position === index ? { ...message, ...update } : message));
}

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

function threadIdOf(frame: ChatStreamFrame): string | undefined {
  const metadata = frame.response_metadata;
  const nested = metadata?.metadata?.thread_id;
  return typeof nested === 'string' ? nested : typeof metadata?.thread_id === 'string' ? metadata.thread_id : undefined;
}


/**
 * One entry in a message's tool timeline. Left open deliberately: the baseline
 * writes provider- and toolkit-specific members onto these objects and the
 * rendering layer reads them by name, so narrowing the shape here would drop
 * data the UI still needs.
 */
export interface ToolAction extends SubAgentGroupable {
  readonly id: string;
  readonly status: string;
  readonly toolMeta?: Record<string, unknown> | undefined;
  readonly [key: string]: unknown;
}

/**
 * The metadata a tool frame carries, merged the way the baseline merges it:
 * `tool_meta.metadata` wins over `response_metadata.metadata`, because the
 * LangChain tool's own metadata is the more specific of the two.
 */
function toolMetadata(frame: ChatStreamFrame): Record<string, unknown> {
  const responseMetadata = frame.response_metadata;
  return {
    ...responseMetadata?.metadata,
    ...responseMetadata?.tool_meta?.metadata,
  };
}

/**
 * Recover a toolkit name the metadata omitted from the tool's description.
 * Two shapes are in the wild — `[Toolkit: name]` (vectorstore, inventory) and a
 * `Toolkit: name` line (most others) — and the baseline tries both before
 * giving up, which is why a single regex here would silently unlabel toolkits.
 */
function toolkitNameFromDescription(description: unknown): string {
  if (typeof description !== 'string') return '';
  const bracketed = /\[Toolkit:\s*([^\]]+)]/.exec(description);
  if (bracketed?.[1]) return bracketed[1].trim();
  const line = /(?:^|\n)Toolkit:\s*([^\n]+)/.exec(description);
  return line?.[1]?.trim() ?? '';
}

/** Toolkit identity, in the baseline's precedence order. */
function toolkitIdentity(frame: ChatStreamFrame, metadata: Record<string, unknown>): {
  readonly name: string;
  readonly type: string;
} {
  const responseMetadata = frame.response_metadata;
  const rawToolName = responseMetadata?.tool_name ?? '';
  // The pre-rename wire format encoded the toolkit in the tool name itself.
  const legacyToolkit = rawToolName.includes('___') ? (rawToolName.split('___')[0] ?? '') : '';
  const fromMetadata = typeof metadata['toolkit_name'] === 'string' ? (metadata['toolkit_name'] as string) : '';
  const fromDescription = toolkitNameFromDescription(responseMetadata?.tool_meta?.description);
  const typeFromMetadata = typeof metadata['toolkit_type'] === 'string' ? (metadata['toolkit_type'] as string) : '';
  return {
    name: fromMetadata || fromDescription || responseMetadata?.toolkit_name || legacyToolkit,
    type: typeFromMetadata || responseMetadata?.toolkit_type || '',
  };
}

/**
 * The tool's display name. A lazy-loading wrapper puts its own class name in
 * `tool_name` and signals the swap with `metadata.original_name`; the real name
 * is then on `tool_meta.name`, and preferring it is what stops the UI showing
 * "LazyLoading" instead of the tool the user invoked.
 */
function toolDisplayName(frame: ChatStreamFrame, metadata: Record<string, unknown>): string | undefined {
  const responseMetadata = frame.response_metadata;
  const wrapped = metadata['original_name'] && responseMetadata?.tool_meta?.name;
  return wrapped ? (responseMetadata.tool_meta?.name as string) : responseMetadata?.tool_name;
}

function findToolAction(message: ChatMessage, runId: string | undefined): ToolAction | undefined {
  if (!runId) return undefined;
  const actions = message.toolActions as readonly ToolAction[] | undefined;
  return actions?.find((action) => action.id === runId);
}

/** Replace one tool action by id, preserving order and leaving the rest untouched. */
function replaceToolAction(
  message: ChatMessage,
  runId: string,
  update: (action: ToolAction) => ToolAction,
): readonly ToolAction[] {
  const actions = (message.toolActions ?? []) as readonly ToolAction[];
  return actions.map((action) => (action.id === runId ? update(action) : action));
}


/**
 * Apply one `thinking_steps` entry to the action it describes.
 *
 * Returns `undefined` when the step names no action we know, so the caller can
 * tell "nothing to update" from "updated to nothing".
 */
function applyThinkingStep(action: ToolAction, step: ThinkingStep): ToolAction {
  const hierarchy = normalizeExecutionHierarchy(step, step.metadata, step.message?.response_metadata?.metadata, action, action.toolMeta);
  // The backend normalises `text` for every provider. The "with inputs {...}"
  // tail is a verbose restatement of arguments the UI already shows, and the
  // baseline strips it rather than rendering it twice.
  const text = convertJsonToString(step.text ?? '', true).replace(/\s+with inputs\s+\{[^}]*\}/g, '');
  const stepModelName = step.message?.response_metadata?.model_name;
  const correctToolName = step.message?.response_metadata?.tool_name;
  const existingMeta = action.toolMeta ?? {};
  const modelName = existingMeta['ls_model_name'];

  const toolMeta: Record<string, unknown> = { ...existingMeta, ...hierarchy };
  if (stepModelName && !modelName) toolMeta['ls_model_name'] = stepModelName;

  const updated: Record<string, unknown> = {
    ...action,
    ...hierarchy,
    content: text,
    ended_at: step.timestamp_finish,
    toolMeta,
  };
  // Only a real node name, never the model's own name echoed back.
  if (correctToolName?.trim() && correctToolName !== toolMeta['ls_model_name']) updated['name'] = correctToolName;
  if (step.thinking) updated['thinking'] = step.thinking;
  return updated as unknown as ToolAction;
}

/**
 * A step that produced no text and belongs to no parent agent is a graph
 * transition, not something a user asked for; the baseline drops it so the
 * timeline shows work rather than plumbing.
 */
function isEmptyTransition(updated: ToolAction): boolean {
  const content = updated['content'];
  const hasText = typeof content === 'string' && content.trim().length > 0;
  return !hasText && !updated.parent_agent_name;
}

/**
 * The key the backend will look this toolkit's OAuth token up under.
 *
 * This is NOT cosmetic and NOT always the server URL: the backend resolves
 * tokens from `kwargs['tokens']` by a key that differs per toolkit family, so
 * getting it wrong stores a token the toolkit will never find and the user is
 * asked to authorize again on every call.
 *
 *   pre-built MCP (`mcp_*`)   the toolkit type — the backend matches by
 *                             server/toolkit name, not by OAuth server URL
 *   delegated OAuth with a    `{configuration_uuid}:{oauth endpoint}`, the
 *   configuration uuid        SDK's primary composite lookup
 *   SharePoint / OpenAPI      the discovery endpoint
 *   regular MCP               the MCP server URL, which IS its OAuth endpoint
 */
function mcpTokenStorageKey(frame: ChatStreamFrame, serverUrl: string): string {
  const responseMetadata = frame.response_metadata;
  const resource = responseMetadata?.resource_metadata;
  const authServers = resource?.authorization_servers ?? responseMetadata?.authorization_servers;
  const oauthEndpoint = authServers?.[0];
  const configUuid = resource?.configuration_uuid;
  const toolkitType = responseMetadata?.toolkit_type;

  if (typeof toolkitType === 'string' && toolkitType.startsWith('mcp_') && toolkitType !== 'mcp') return toolkitType;
  if (configUuid && oauthEndpoint) return `${configUuid}:${oauthEndpoint}`;
  if (resource?.resource_name === 'SharePoint' || resource?.resource_name === 'OpenAPI') {
    return oauthEndpoint ?? serverUrl;
  }
  return serverUrl;
}

/**
 * The one raw interrupt a single pause implies.
 *
 * A single pause does not send `hitl_interrupts`; its detail is split between
 * legacy top-level metadata and the nested `hitl_interrupt`, and reading only
 * one of the two loses either the routing fields or the tool detail the card
 * renders.
 */
function singlePauseRaw(frame: ChatStreamFrame): Record<string, unknown> {
  const responseMetadata = frame.response_metadata;
  const nested = responseMetadata?.hitl_interrupt ?? {};
  return {
    message: responseMetadata?.message,
    node_name: responseMetadata?.node_name,
    available_actions: responseMetadata?.available_actions,
    routes: responseMetadata?.routes,
    edit_state_key: responseMetadata?.edit_state_key,
    guardrail_type: nested['guardrail_type'],
    tool_name: nested['tool_name'],
    toolkit_name: nested['toolkit_name'],
    toolkit_type: nested['toolkit_type'],
    action_label: nested['action_label'],
    tool_args: nested['tool_args'],
    policy_message: nested['policy_message'],
    interrupt_id: nested['interrupt_id'] ?? responseMetadata?.interrupt_id,
    tool_call_id: nested['tool_call_id'],
    resume_strategy: nested['resume_strategy'] ?? responseMetadata?.resume_strategy,
  };
}

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
 * The MCP session a tool frame reports, for a CALLER to persist.
 *
 * The baseline calls `McpAuthHelpers.setSessionId` from inside the reducer.
 * That is I/O, so it cannot live here — but dropping it would silently break
 * MCP re-authorization, so the pair is surfaced instead of discarded.
 */
export function mcpSessionFromFrame(
  frame: ChatStreamFrame,
): { readonly serverUrl: string; readonly sessionId: string } | undefined {
  const metadata = toolMetadata(frame);
  const sessionId = metadata['mcp_session_id'];
  const serverUrl = metadata['mcp_server_url'];
  if (typeof sessionId !== 'string' || typeof serverUrl !== 'string' || !sessionId || !serverUrl) return undefined;
  return { serverUrl, sessionId };
}

/**
 * Apply one streaming frame.
 *
 * Returns the SAME array reference when the frame changes nothing, so a caller
 * passing this to `setState` does not re-render on frames this slice ignores.
 */
export function applyChatStreamFrame(
  history: readonly ChatMessage[],
  frame: ChatStreamFrame,
  context: ChatStreamContext = {},
): readonly ChatMessage[] {
  const type = frame.type;
  if (!type) return history;

  const index = findTarget(history, frame);

  switch (type) {
    // The turn begins. The baseline resets content here unless it is resuming a
    // continuation, so a regenerate does not append to the previous answer.
    case SocketMessageType.StartTask:
    case SocketMessageType.AgentStart: {
      if (index === -1) return [...history, createAssistantMessage(frame, context)];
      return replaceAt(history, index, {
        content: '',
        isStreaming: true,
        isLoading: true,
        references: [],
        exception: undefined,
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
        isLoading: true,
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

    // A step reports progress for a tool that may not have started yet: a
    // thinking step can arrive BEFORE its agent_tool_start, so this creates a
    // placeholder rather than dropping the progress.
    case SocketMessageType.AgentThinkingStep: {
      if (index === -1) return history;
      const current = history[index];
      const runId = frame.response_metadata?.tool_run_id;
      if (!current) return history;
      const metadata = toolMetadata(frame);
      const actions = (current.toolActions ?? []) as readonly ToolAction[];
      const existing = runId ? actions.find((action) => action.id === runId) : undefined;
      const hierarchy = normalizeExecutionHierarchy(
        frame.response_metadata?.metadata,
        frame.response_metadata?.tool_meta?.metadata,
        existing,
        existing?.toolMeta,
      );

      if (existing && runId) {
        return replaceAt(history, index, {
          toolActions: replaceToolAction(current, runId, (action) => ({
            ...action,
            ...hierarchy,
            message: frame.response_metadata?.message,
            // `?? true`, not the baseline's `|| true`, which can only ever
            // yield true and so silently ignored an explicit `markdown: false`.
            markdown: frame.response_metadata?.markdown ?? true,
            toolMeta: { ...action.toolMeta, ...metadata, ...hierarchy },
          })),
        });
      }

      // The baseline's id here is `'thinking_step_' + toolRunId || '' + v4()`,
      // which parses as `('thinking_step_' + toolRunId) || ('' + v4())` — always
      // truthy, so the uuid fallback never ran and every id-less step collided
      // on the literal "thinking_step_undefined". The intent is a unique id.
      const placeholderId = `thinking_step_${runId ?? crypto.randomUUID()}`;
      const draft: Record<string, unknown> = {
        id: placeholderId,
        name: TOOL_ACTION_TYPES.Toolkit,
        type: TOOL_ACTION_TYPES.Toolkit,
        status: ToolActionStatus.processing,
        ...hierarchy,
        toolInputs: frame.response_metadata?.tool_inputs,
        toolOutputs: frame.response_metadata?.tool_outputs,
        toolMeta: { ...metadata, ...hierarchy },
        responseMetadata: frame.response_metadata,
        created_at: frame.created_at,
        markdown: frame.response_metadata?.markdown ?? true,
        renderHtml: frame.response_metadata?.render_html ?? false,
        message: frame.response_metadata?.message,
        content: '',
      };
      return replaceAt(history, index, {
        toolActions: [...actions, draft as unknown as ToolAction],
      });
    }

    // Progress text for a step already on the timeline.
    case SocketMessageType.AgentThinkingStepUpdate: {
      if (index === -1) return history;
      const current = history[index];
      const runId = frame.response_metadata?.tool_run_id;
      if (!current || !runId || !findToolAction(current, runId)) return history;
      const toolMetaFromFrame = frame.response_metadata?.tool_meta;

      return replaceAt(history, index, {
        toolActions: replaceToolAction(current, runId, (action) => {
          const hierarchy = normalizeExecutionHierarchy(
            frame.response_metadata?.metadata,
            frame.response_metadata?.tool_meta?.metadata,
            action,
            action.toolMeta,
          );
          return {
            ...action,
            ...hierarchy,
            message: convertJsonToString(frame.response_metadata?.message, true),
            markdown: frame.response_metadata?.markdown ?? false,
            // Only when the frame supplies one: the toolkit badge reads this,
            // and overwriting it with nothing would blank the badge mid-run.
            ...(toolMetaFromFrame ? { toolMeta: { ...action.toolMeta, ...toolMetaFromFrame, ...hierarchy } } : {}),
          } as ToolAction;
        }),
      });
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


    // A tool started. Creates the timeline entry the UI renders as a chip; a
    // repeat for the same run id updates ancestry rather than duplicating it.
    case SocketMessageType.AgentToolStart: {
      if (index === -1) return history;
      const current = history[index];
      const runId = frame.response_metadata?.tool_run_id;
      if (!current || !runId) return history;
      const metadata = toolMetadata(frame);
      const hierarchy = normalizeExecutionHierarchy(metadata, frame.response_metadata);
      const threadId = threadIdOf(frame);
      const existing = findToolAction(current, runId);

      if (existing) {
        return replaceAt(history, index, {
          toolActions: replaceToolAction(current, runId, (action) => ({
            ...action,
            ...hierarchy,
            toolMeta: { ...action.toolMeta, ...metadata, ...hierarchy },
          })),
          ...(threadId !== undefined ? { threadId } : {}),
        });
      }

      const toolkit = toolkitIdentity(frame, metadata);
      // Built imperatively, not with conditional spreads: spreading a
      // `{name: X} | {}` union infers `name?: X | undefined`, which
      // `exactOptionalPropertyTypes` rejects against `SubAgentGroupable`'s
      // "absent or string". Same convention as
      // `useToolkitChatSocket.hooks.ts:79-90`.
      const draft: Record<string, unknown> = {
        id: runId,
        type: TOOL_ACTION_TYPES.Tool,
        status: ToolActionStatus.processing,
        message: '',
        ...hierarchy,
        toolInputs: frame.response_metadata?.tool_inputs,
        toolOutputs: frame.response_metadata?.tool_outputs,
        toolMeta: { ...metadata, toolkit_type: toolkit.type, toolkit_name: toolkit.name, ...hierarchy },
        created_at: frame.response_metadata?.timestamp_start ?? frame.created_at,
      };
      const displayName = toolDisplayName(frame, metadata);
      if (displayName !== undefined) draft['name'] = displayName;
      if (typeof metadata['original_name'] === 'string') draft['original_name'] = metadata['original_name'];
      const created = draft as unknown as ToolAction;
      return replaceAt(history, index, {
        toolActions: [...((current.toolActions ?? []) as readonly ToolAction[]), created],
        ...(threadId !== undefined ? { threadId } : {}),
      });
    }

    // The tool returned. Outputs ACCUMULATE — a string appends, an object
    // merges — because a tool may report progressively, and replacing would
    // discard everything but the last frame.
    case SocketMessageType.AgentToolEnd: {
      if (index === -1) return history;
      const current = history[index];
      const runId = frame.response_metadata?.tool_run_id;
      if (!current || !runId || !findToolAction(current, runId)) return history;
      const metadata = toolMetadata(frame);

      return replaceAt(history, index, {
        toolActions: replaceToolAction(current, runId, (action) => {
          const hierarchy = normalizeExecutionHierarchy(metadata, action, action.toolMeta);
          const output = frame.response_metadata?.tool_output;
          const previous = action['toolOutputs'];
          let toolOutputs = previous;
          if (typeof output === 'string') {
            toolOutputs = (typeof previous === 'string' ? previous : '') + convertJsonToString(output, true);
          } else if (typeof output === 'object' && output !== null) {
            toolOutputs = { ...((typeof previous === 'object' && previous !== null ? previous : {}) as object), ...output };
          }
          return {
            ...action,
            ...hierarchy,
            toolOutputs,
            message: undefined,
            content: convertJsonToString(frame.content ?? ''),
            // An action awaiting approval stays awaiting it: the wrapper ending
            // is not the user answering.
            status: action.status === ToolActionStatus.actionRequired ? action.status : ToolActionStatus.complete,
            ended_at: frame.response_metadata?.timestamp_finish ?? frame.created_at,
            created_at: frame.response_metadata?.timestamp_start ?? action['created_at'],
            toolMeta: { ...action.toolMeta, ...metadata, ...hierarchy },
          };
        }),
      });
    }

    case SocketMessageType.AgentToolError: {
      if (index === -1) return history;
      const current = history[index];
      const runId = frame.response_metadata?.tool_run_id;
      if (!current || !runId || !findToolAction(current, runId)) return history;
      const metadata = toolMetadata(frame);

      return replaceAt(history, index, {
        toolActions: replaceToolAction(current, runId, (action) => {
          const hierarchy = normalizeExecutionHierarchy(metadata, action, action.toolMeta);
          return {
            ...action,
            ...hierarchy,
            content: convertJsonToString(frame.content ?? ''),
            status: ToolActionStatus.error,
            ended_at: frame.created_at,
            isError: true,
            toolMeta: { ...action.toolMeta, ...metadata, ...hierarchy },
          };
        }),
      });
    }

    // An MCP toolkit answered 401. This is a tool action, not a message: the
    // authorization card renders as a timeline entry so the rest of the turn's
    // work stays visible behind it.
    case SocketMessageType.McpAuthorizationRequired: {
      if (index === -1) return history;
      const current = history[index];
      if (!current) return history;
      const responseMetadata = frame.response_metadata;
      const runId = responseMetadata?.tool_run_id ?? crypto.randomUUID();
      const toolName = responseMetadata?.tool_name ?? 'MCP toolkit';
      const serverUrl = responseMetadata?.server_url ?? 'MCP server';
      const statusCode = responseMetadata?.status ?? 401;
      const authServers = responseMetadata?.resource_metadata?.authorization_servers ?? responseMetadata?.authorization_servers;
      const hasAuthServers = Boolean(authServers && authServers.length > 0);

      const draft: Record<string, unknown> = {
        name: toolName,
        id: runId,
        status: hasAuthServers ? ToolActionStatus.actionRequired : ToolActionStatus.error,
        toolInputs: undefined,
        toolOutputs: hasAuthServers
          ? {
              resource_metadata_url: responseMetadata?.resource_metadata_url ?? null,
              authorization_servers: authServers,
              server_url: mcpTokenStorageKey(frame, serverUrl),
            }
          : undefined,
        toolMeta: responseMetadata,
        created_at: frame.created_at,
        ended_at: frame.created_at,
        type: TOOL_ACTION_TYPES.Toolkit,
        markdown: false,
        renderHtml: false,
        content: hasAuthServers
          ? // `authServers` is non-empty on this branch by construction.
            `${convertJsonToString(frame.content ?? 'Authorization required.', true)}${
              responseMetadata?.resource_metadata_url
                ? `\n\nResource metadata: ${responseMetadata.resource_metadata_url}`
                : `\n\nAuthorization servers: ${(authServers ?? []).join(', ')}`
            }`
          : `${statusCode}: Authorization error in "${toolName}" toolkit.\n\n` +
            `The MCP server at ${serverUrl} requires OAuth authorization, but the server ` +
            `did not provide the authorization server configuration. ` +
            `Please contact the server administrator or check the toolkit configuration.`,
      };

      const actions = (current.toolActions ?? []) as readonly ToolAction[];
      const exists = actions.some((action) => action.id === runId);
      const next = exists
        ? actions.map((action) => (action.id === runId ? ({ ...action, ...draft } as ToolAction) : action))
        : [...actions, draft as unknown as ToolAction];

      // The user has to act, so nothing is in flight any more.
      return replaceAt(history, index, {
        toolActions: next,
        isLoading: false,
        isStreaming: false,
        isRegenerating: false,
      });
    }

    // The model stopped on its token limit rather than on an answer. The turn
    // is not finished — `requiresConfirmation` is what renders the continue
    // button that resumes it.
    case SocketMessageType.AgentRequiresConfirmation: {
      if (index === -1) return history;
      const current = history[index];
      if (!current) return history;
      const threadId = threadIdOf(frame);
      const buttonText = typeof frame.content === 'string' && frame.content ? frame.content : 'Continue';

      return replaceAt(history, index, {
        isLoading: false,
        // Mono chat keeps the same bubble streaming across the continue; a
        // multi-participant conversation must release the floor.
        isStreaming: Boolean(context.isMonoChatting),
        isRegenerating: false,
        // Only when the frame supplies one: the thread was already set by the
        // response or tool frames of THIS message, and blanking it would strand
        // the continue request with nowhere to resume.
        ...(threadId !== undefined ? { threadId } : {}),
        requiresConfirmation: {
          message: "Token limit reached mid-response. Press 'Continue' to see more.",
          buttonText,
        },
      });
    }

    // Execution paused for a human decision. Three shapes, and which one it is
    // decides both the streaming state and how the entries accumulate.
    case SocketMessageType.AgentHitlInterrupt: {
      if (index === -1) return history;
      const current = history[index];
      if (!current) return history;
      const responseMetadata = frame.response_metadata;
      const hitlMeta = (responseMetadata?.metadata ?? {}) as Record<string, unknown>;
      const childThreadId = typeof hitlMeta['child_thread_id'] === 'string' ? hitlMeta['child_thread_id'] : '';

      // Fan-out child: the indexer stamped the child's own thread and its
      // parent's name into event metadata. One child of many pauses while its
      // siblings keep running.
      const isFanoutChild = Boolean(hitlMeta['parent_agent_name'] && childThreadId);

      const rawInterrupts = Array.isArray(responseMetadata?.hitl_interrupts) ? responseMetadata.hitl_interrupts : [];
      // In-process parallel aggregate: N paused sub-agents in ONE frame, each
      // labelled with its parent but with no child thread of its own.
      const isParallelAggregate =
        !isFanoutChild && rawInterrupts.some((raw) => Boolean(raw?.['parent_agent_name']));

      // Only a plain single pause ends the run's activity. Both parallel shapes
      // keep `isStreaming` true, and that is load-bearing rather than cosmetic:
      // flipping it off collapses the live thinking view into its history
      // accordion, hiding every sibling that has not independently rendered an
      // approval card — including ones that finished without pausing.
      const streamingState =
        isFanoutChild || isParallelAggregate
          ? { isStreaming: true, isLoading: false, isRegenerating: false }
          : { isStreaming: false, isLoading: false, isRegenerating: false };

      const fallbackMessage =
        (typeof responseMetadata?.message === 'string' ? responseMetadata.message : '') || current.content;
      const build = (raw: Record<string, unknown>): NormalizedHitlInterrupt =>
        normalizeHitlInterrupt(
          { ...raw, message: raw['message'] ?? fallbackMessage },
          { ...hitlMeta, child_thread_id: childThreadId, thread_id: childThreadId },
        );

      const incoming: readonly NormalizedHitlInterrupt[] =
        rawInterrupts.length > 0
          ? rawInterrupts.map(build)
          : // Single pause: the detail is split between legacy top-level fields
            // and the nested `hitl_interrupt`, so one entry is synthesised from
            // both rather than from either alone.
            [build(singlePauseRaw(frame))];

      const existing = (current.hitlInterrupts ?? []) as readonly NormalizedHitlInterrupt[];
      let hitlInterrupts: readonly NormalizedHitlInterrupt[] | undefined;
      if (isFanoutChild) {
        // Children announce one frame at a time, so these ACCUMULATE; merging by
        // identity is what stops a re-announcement duplicating a pending card.
        hitlInterrupts = mergeHitlInterrupts(existing, incoming);
      } else if (rawInterrupts.length > 0) {
        hitlInterrupts = incoming;
      } else {
        // Left UNSET deliberately: the consumer detects "parallel" from the mere
        // presence of the array, so populating it for a single pause would route
        // resume through the parallel `hitl_decisions` shape instead of the
        // sequential one the backend expects. The renderer falls back to
        // `[hitlInterrupt]`.
        hitlInterrupts = undefined;
      }

      const threadId =
        current.threadId ??
        (typeof hitlMeta['thread_id'] === 'string' ? hitlMeta['thread_id'] : undefined) ??
        responseMetadata?.thread_id;

      // Content is deliberately NOT overwritten with the interrupt text: the
      // pause renders from the card, and a written-in "requires approval" line
      // would linger in the bubble after the user resumes.
      return replaceAt(history, index, {
        ...streamingState,
        hitlInterrupts,
        // Kept populated for consumers that read the singular field, and it is
        // the SOLE carrier on the single-pause path above. The merged head is
        // preferred so it tracks the first still-pending child.
        hitlInterrupt: hitlInterrupts?.[0] ?? incoming[0],
        // A fan-out child resumes on its own thread, carried per entry — parking
        // the whole message on whichever child paused last would misroute it.
        ...(!isFanoutChild && threadId !== undefined ? { threadId } : {}),
      });
    }

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

    // The conversation echoing a USER question back over the stream — the one
    // frame in the vocabulary that produces a user message rather than
    // advancing the assistant's.
    //
    // Its id is `uuid`, NOT `message_id`, so `index` is meaningless here.
    case SocketMessageType.ChatUserMessage: {
      const id = frame.uuid;
      if (!id) return history;
      const participants = context.participants ?? [];
      const author = participants.find((participant) => participant.id === frame.author_participant_id);
      const sentTo = participants.find((participant) => participant.id === frame.sent_to_id);
      const createdAt = frame.created_at;

      const question: ChatMessage = {
        id,
        role: ROLES.User,
        // The baseline's LIVE resolution, which is barer than the persisted
        // path's `getMessageAuthorName` (email / "User <id>" / "User No Longer
        // Available" fallbacks). Reproduced rather than upgraded, for the same
        // reason as the swarm-child shape: the two paths render the same
        // conversation side by side.
        name: author?.meta?.user_name ?? '',
        avatar: author?.meta?.user_avatar ?? '',
        content: typeof frame.content === 'string' ? frame.content : convertJsonToString(frame.content ?? ''),
        // An ISO string, as `ChatMessage.createdAt` is typed and the persisted
        // builder produces — the baseline's epoch-ms number would render as a
        // different timestamp format for a live question than for a replayed one.
        createdAt: typeof createdAt === 'string' ? convertTime(createdAt) : nowIso(context),
        ...(frame.message_items !== undefined ? { messageItems: frame.message_items } : {}),
        ...(frame.author_participant_id !== undefined ? { userId: String(frame.author_participant_id) } : {}),
        ...(frame.sent_to_id !== undefined ? { participantId: String(frame.sent_to_id) } : {}),
        ...(sentTo !== undefined ? { sentTo } : {}),
      };

      // DEVIATION: the baseline appends unconditionally. Its own
      // `addMessageToChatHistory` guards the assistant path against exactly
      // this ("Guard against duplicate insertion", hooks.js:206-216) because
      // racing frames re-insert a message already in state; the user echo is
      // the un-guarded outlier, and an echo of a question already on screen
      // would render the user's own message twice. The same guard is applied
      // here rather than reproducing the omission.
      const existing = history.findIndex((message) => message.id === id);
      if (existing !== -1) return replaceAt(history, existing, question);
      return [...history, question];
    }

    // The raw swarm lifecycle. State-inert on purpose, and NOT forwarded
    // either: the baseline's comment is explicit that the UI renders swarm work
    // from swarm_child_message alone, so these three would be a second, partial
    // source for the same accordions.
    case SocketMessageType.AgentSwarmAgentStart:
    case SocketMessageType.AgentSwarmAgentResponse:
    case SocketMessageType.AgentSwarmHandoff:
      return history;

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

    // Not yet ported (see the module doc). Returning the input reference is the
    // point: an unported frame must be inert, never a partial write.
    default:
      return history;
  }
}
