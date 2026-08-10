/**
 * `useToolkitChat`'s `buildMessagePayload` seam — the `chat_predict` body
 * for a toolkit/index run.
 *
 * Port of the DEFAULT branch of `apps/elitea-ui/src/common/
 * messagePayloadUtils.js`'s `generateMessagePayload`. Only that branch is
 * reachable from here: `useToolkitChatDispatch.hooks.ts:86` always passes
 * the conversation's TOOLKIT participant, and the two other branches key on
 * `entity_name` being `applications`/`pipelines`.
 *
 * Faithfully ported from that branch:
 *  - `user_input`, `project_id`, `participant_id`, `conversation_uuid`,
 *    `question_id`, `interaction_uuid`
 *  - `llm_settings` = `{model_name, model_project_id, ...llmSettings}` (the
 *    caller has no `unsavedLLMSettings`, so the baseline's ternary settles
 *    on its `selectedModel` arm — with this slice's own `llmSettings`
 *    merged in, matching `createToolkitConversationWithParticipant`'s own
 *    `entity_settings.llm_settings` shape so the run and the participant
 *    settings agree)
 *  - `attachments_info: []` — this panel has no attachment affordance at
 *    all, so the baseline's `filter(item => item.filepath)` over an empty
 *    list is `[]`. Emitted rather than omitted: the baseline always emits
 *    the key.
 *
 * TWO DISCLOSED OMISSIONS, both structural, neither silent:
 *
 *  1. `mcp_tokens: McpAuthHelpers.getAllTokens()`. That helper lives in
 *     `features/mcps`, and `no-sideways-features` (R-L1, `.dependency-
 *     cruiser.cjs`) forbids `features/toolkits` importing it — a permanent
 *     layer rule, not a landing-order gap. Practical blast radius is small
 *     and bounded: per-user MCP OAuth tokens only matter for `mcp`-type
 *     toolkits, and the Indexes tab those runs would come from is not
 *     offered on MCP screens at all (`pages/toolkits/lib/
 *     indexesTabVisibility.ts` ports the baseline's own `shouldHideIndexesTab`
 *     `if (mcpId) return true`). A non-MCP toolkit's own credentials travel
 *     in the participant's `entity_settings`, not here.
 *  2. `user_ids`/`isSendingToUser`. The baseline emits `user_ids` only when
 *     `isSendingToUser` is true — a human-to-human chat concept with no
 *     equivalent in a single-participant toolkit test conversation. The
 *     baseline itself sends `undefined` in that case.
 */

/** One conversation participant, as `useToolkitChatDispatch.hooks.ts` resolves it. */
export interface ToolkitPayloadParticipant {
  readonly id?: string | number;
  readonly entity_name?: string;
}

export interface BuildToolkitMessagePayloadInput {
  readonly conversation_uuid: string | undefined;
  readonly interaction_uuid: string;
  readonly projectId: string | undefined;
  readonly selectedModel: { readonly name?: string; readonly project_id?: string | number } | null;
  readonly participant: ToolkitPayloadParticipant | undefined;
  readonly llmSettings: Readonly<Record<string, unknown>>;
  readonly participants: readonly unknown[];
}

export function buildToolkitMessagePayload(input: BuildToolkitMessagePayloadInput): Readonly<Record<string, unknown>> {
  const { conversation_uuid, interaction_uuid, projectId, selectedModel, participant, llmSettings } = input;

  return {
    // The baseline's `question`/`question_id` for a TOOL run are empty: the
    // run's real input rides `tool_call_input` (added by the caller at
    // `useToolkitChatDispatch.hooks.ts:94`), not the chat text box.
    user_input: '',
    question_id: interaction_uuid,
    llm_settings: {
      model_name: selectedModel?.name,
      model_project_id: selectedModel?.project_id,
      ...llmSettings,
    },
    project_id: projectId,
    participant_id: participant?.id,
    conversation_uuid,
    interaction_uuid,
    attachments_info: [],
  };
}
