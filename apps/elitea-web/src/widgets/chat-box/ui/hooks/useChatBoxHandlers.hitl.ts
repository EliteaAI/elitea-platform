/**
 * hooks/useChatBoxHandlers.hitl.ts — the HITL continuation body.
 *
 * `continueHitl` resumes a paused run over REST
 * (`POST /elitea_core/continue_predict/prompt_lib/{projectID}/{conversationID}`
 * with `execution_contract=agent.continue.hitl.v1`). The route validates every
 * field of that body, so the shaping lives here, beside the rules it obeys,
 * rather than inside the handler.
 *
 * Its own file for the §3.5 file-length budget: `useChatBoxHandlers.helpers.ts`
 * is already at the limit.
 */
import type { ChatMessage } from '@/features/chat-messages';

import type { HitlInterruptAction } from './useChatBoxHandlers.helpers';

/** The four `hitl_action` values the Go route admits (`currentRootHITLAction`). */
const ROOT_HITL_ACTIONS: readonly string[] = ['approve', 'reject', 'edit', 'block_with_comment'];

/** One entry of the `hitl_decisions` array. The route admits these four keys and no other. */
interface HitlDecision {
  readonly interrupt_id: string;
  readonly tool_call_id: string;
  readonly action: string;
  readonly value: string;
}

export interface HitlContinueBodyParams {
  readonly projectId: string | number | undefined;
  readonly conversationUuid: string | undefined;
  readonly messageId: string;
  readonly threadId?: string | undefined;
  readonly action: HitlInterruptAction;
  readonly interruptId?: string | undefined;
}

/**
 * The `interrupt_id` of the pause one decision answers.
 *
 * The route REQUIRES the field in every `hitl_decisions` entry, so a pause
 * that carries none cannot be resumed over REST at all.
 */
export function findHitlInterruptId(message: ChatMessage, toolCallId: string | undefined): string | undefined {
  const entries = (message.hitlInterrupts ?? []) as readonly { readonly interrupt_id?: string; readonly tool_call_id?: string }[];
  const match = toolCallId ? entries.find((entry) => entry.tool_call_id === toolCallId) : entries[0];
  const single = message.hitlInterrupt as { readonly interrupt_id?: string } | undefined;
  const id = match?.interrupt_id ?? single?.interrupt_id;
  return id ? id : undefined;
}

/**
 * The identity fields the route checks first, or `undefined` when this pause
 * cannot address the route at all.
 *
 * `project_id` is a NUMBER and must equal the path project; the socket payload
 * sends a string, so it is rebuilt rather than reused. `conversation_uuid`
 * must equal the path conversation, and `message_id` must not be empty.
 */
function hitlContinueIdentity(params: HitlContinueBodyParams): Record<string, unknown> | undefined {
  const projectId = Number(params.projectId);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return undefined;
  if (!params.conversationUuid || !params.messageId) return undefined;
  return {
    project_id: projectId,
    conversation_uuid: params.conversationUuid,
    message_id: params.messageId,
    ...(params.threadId ? { thread_id: params.threadId } : {}),
    hitl_resume: true,
  };
}

/**
 * The one decision a fan-out child's resume carries.
 *
 * `thread_id` belongs at the TOP level of the body. Inside a decision entry
 * the route refuses it, because `currentHITLDecisions` admits only
 * `interrupt_id`, `tool_call_id`, `action` and `value`.
 */
function hitlFanoutDecision(params: HitlContinueBodyParams): HitlDecision | undefined {
  if (!params.interruptId) return undefined;
  return {
    interrupt_id: params.interruptId,
    tool_call_id: params.action.toolCallId ?? '',
    action: params.action.action,
    value: params.action.value ?? '',
  };
}

/**
 * The HITL continuation body, or `undefined` when this pause cannot be
 * expressed in the contract.
 *
 * `undefined` means "no REST body fits", and the caller then emits over the
 * socket. A fan-out child whose interrupt carries no `interrupt_id` is the one
 * pause that lands there.
 *
 * The body never carries `mcp_tokens`, `ignored_mcp_servers` or
 * `user_declined_mcp_servers`: the route refuses all three alongside a HITL
 * resume.
 */
export function buildHitlContinueBody(params: HitlContinueBodyParams): Record<string, unknown> | undefined {
  const base = hitlContinueIdentity(params);
  if (base === undefined) return undefined;
  if (params.action.childThreadId) {
    const decision = hitlFanoutDecision(params);
    return decision === undefined ? undefined : { ...base, hitl_decisions: [decision] };
  }
  if (!ROOT_HITL_ACTIONS.includes(params.action.action)) return undefined;
  const withValue = params.action.action === 'edit' || params.action.action === 'block_with_comment'
    ? { hitl_value: params.action.value ?? '' }
    : {};
  return { ...base, hitl_action: params.action.action, ...withValue };
}
