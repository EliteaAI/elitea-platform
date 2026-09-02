/**
 * The two provider calls one chat turn makes, as plain async functions.
 *
 * NOT the generated hooks, and the distinction is not stylistic. `orval.config.ts`
 * sets `override.query.useQuery: true`, so EVERY generated operation becomes a
 * query hook — `useInvokeDeepWikiTool` included. Calling that would fire the
 * POST as a query: on mount, again on refocus, and again on reconnect. A
 * question would be asked several times and billed several times, and the
 * screen would look fine. `wikiChatApi.test.ts` asserts this module imports the
 * function and not the hook.
 *
 * That is the house convention rather than a DeepWiki defect — every feature
 * hand-wraps `eliteaFetch` in its own mutation, and
 * `features/settings/api/ai-configuration/api.ts` is the pattern.
 */
import {
  getDeepWikiInvocation,
  invokeDeepWikiTool,
} from '@/shared/api/generated/deepwiki/deepwiki';
import { unwrapBody } from '@/shared/api/unwrap';
import type { ChatInvocationPoll, ChatInvokeInput } from '@/features/wiki-chat';

/** What the drawer knows about the toolkit it is asking. */
export interface WikiChatTarget {
  readonly projectId: number;
  readonly toolkitId: number;
  readonly toolkitName: string;
  readonly toolkitType: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly repoIdentifierOverride?: string | undefined;
  readonly analysisKeyOverride?: string | undefined;
}

/**
 * The one setting the request cannot be built without.
 *
 * The legacy drawer threw here with this sentence, and the throw is the
 * behaviour: an invocation sent with no model is accepted by the facade and
 * fails inside the provider, where the user is told nothing useful.
 */
export function requireLlmModel(settings: Readonly<Record<string, unknown>>): string {
  const model = settings['toolkit_configuration_llm_model'];
  if (typeof model !== 'string' || model === '') {
    throw new Error('Toolkit settings missing llm_model. Configure it in toolkit settings first.');
  }
  return model;
}

/** The provider's invocation envelope for one question. */
export function buildInvokeRequest(target: WikiChatTarget, input: ChatInvokeInput) {
  const llmModel = requireLlmModel(target.settings);
  const maxTokens = target.settings['toolkit_configuration_max_tokens'];

  return {
    configuration: { parameters: { ...target.settings } },
    parameters: {
      question: input.question,
      chat_history: input.history,
      // The overrides are OMITTED rather than sent empty: the provider's merge
      // rule takes a tool argument over a configuration value only when it is
      // truthy, so an empty string would be ignored anyway and a null would
      // widen the envelope for nothing.
      ...(target.repoIdentifierOverride ? { repo_identifier_override: target.repoIdentifierOverride } : {}),
      ...(target.analysisKeyOverride ? { analysis_key_override: target.analysisKeyOverride } : {}),
      ...(input.capability === 'research'
        ? { research_type: 'general', enable_subagents: true }
        : {}),
      llm_model: llmModel,
      llm_settings: { max_tokens: maxTokens ?? 4096, model_name: llmModel },
      stream_id: input.streamId,
      message_id: input.messageId,
    },
  };
}

/**
 * Start one invocation and return its id.
 *
 * `unwrapBody` because `eliteaFetch` resolves the transport ENVELOPE, not the
 * body: reading `invocation_id` off the envelope yields undefined on a 200, and
 * the drawer then polls `undefined` for ever with the spinner still turning
 * (issue #132's shape).
 */
export async function startWikiChat(
  target: WikiChatTarget,
  input: ChatInvokeInput,
): Promise<string> {
  const response = await invokeDeepWikiTool(
    target.projectId,
    target.toolkitName,
    input.toolName,
    buildInvokeRequest(target, input),
  );
  const body = unwrapBody(response) as { invocation_id?: unknown } | undefined;
  const id = body?.invocation_id;
  if (typeof id !== 'string' || id === '') {
    throw new Error('The provider accepted the question but returned no invocation to follow.');
  }
  return id;
}

/** Poll one invocation. */
export async function pollWikiChat(
  target: WikiChatTarget,
  toolName: string,
  invocationId: string,
): Promise<ChatInvocationPoll | undefined> {
  const response = await getDeepWikiInvocation(
    target.projectId,
    target.toolkitName,
    toolName,
    invocationId,
  );
  return unwrapBody(response) as ChatInvocationPoll | undefined;
}
