/**
 * api/canvasQuickFix.ts — the three reads the canvas mermaid quick-fix needs
 * (Canvas slice 2b), hand-registered per R-A5 (`eliteaFetch`, plus the
 * matching `endpoints.manifest.json` rows).
 *
 *  1. `GET /configurations/models/{projectId}` — carries
 *     `low_tier_default_model_name` / `low_tier_default_model_project_id`
 *     (`services/elitea-main/internal/application/configurations/models.go:81-82`).
 *  2. `GET /configurations/configurations/{projectId}?section=service_prompts`
 *     — the authored `MERMAID_QUICK_FIX` service prompt.
 *  3. `POST /elitea_core/predict_llm/prompt_lib/{projectId}` — BLOCKING mode
 *     (`await_task_timeout: 60`), unlike `features/pipelines/api/
 *     aiAssistantPredict.ts`'s streaming (`await_task_timeout: 0`) call of
 *     the same path.
 *
 *     **THIS PATH IS ROUTED, IN THIS MODE ONLY.** It was not, for a long time:
 *     an earlier revision of this comment claimed it was "registered at
 *     services/elitea-main/internal/api/router.go:427-429", which was wrong,
 *     and `internal/api/router.go`'s NOTE(#126) recorded what actually
 *     happened — the Predict/LLM group stood behind a nil gate on
 *     `RouterConfig.Predictor` that nothing ever assigned, so chi answered
 *     `404 page not found` in every deployment. elitea-main now serves the
 *     BLOCKING mode by calling the LLM gateway directly, and
 *     `api/openapi/v2.yaml` declares it. The STREAMING mode is still
 *     unserved: it needs an `application_predict` socket.io task channel the
 *     Go stack does not have.
 *
 *     `shared/config/backendCapabilities.ts` records that split as two flags.
 *     This sender reads `llmPredictBlocking`.
 *     `../model/useMermaidQuickFix.ts` checks it as gate condition 1, BEFORE
 *     the two configuration reads, so a deployment with no LLM gateway makes
 *     no request and renders no control.
 *
 * WHY LOCAL COPIES: `features/pipelines/api/aiAssistantConfigurations.ts` and
 * `features/settings/api/ai-configuration/api.ts` already speak (1) and (2),
 * but `.dependency-cruiser.cjs`'s `no-sideways-features` forbids
 * `features/chat-messages` importing either. Same "duplicate locally rather
 * than reach across a slice boundary" precedent those two files each cite.
 *
 * READS 1 AND 2 SIT BEHIND `ELITEA_CONFIGURATIONS_ENABLED`, which is `false`
 * in a default install, and 2 additionally needs a seeded `MERMAID_QUICK_FIX`
 * row. WRITE 3 additionally needs an LLM gateway (see above). The consequence is deliberate
 * and lives in `../model/useMermaidQuickFix.ts`: unless every one of those can
 * work, the quick-fix control is not rendered. It is never rendered as a
 * button that only ever toasts an error.
 *
 */
import { eliteaFetch } from '@/shared/api/generated/mutator';

import type { MermaidQuickFixModelsWire } from '../lib/mermaidQuickFix';

/** Every hand-registered endpoint in this codebase unwraps orval's `{data,status,headers}` envelope here; reading it as the body makes every field `undefined` (#132). */
async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options);
  return envelope.data;
}

/** (1) The project's LLM models, including its tier defaults. */
export async function getQuickFixModels(
  projectId: string | number,
  signal?: AbortSignal,
): Promise<MermaidQuickFixModelsWire> {
  const params = new URLSearchParams({ section: 'llm', include_shared: 'true' });
  return fetchData<MermaidQuickFixModelsWire>(
    `/configurations/models/${projectId}?${params.toString()}`,
    signal ? { signal } : {},
  );
}

/** One `service_prompts` configuration row. Not exported: nothing outside this file names it (`knip --max-issues 0`). */
interface ServicePromptWire {
  readonly id?: string | number;
  readonly type?: string;
  readonly elitea_title?: string;
  readonly data?: { readonly key?: string; readonly prompt?: string };
}

export interface ServicePromptPageWire {
  readonly items?: readonly ServicePromptWire[];
  readonly shared?: { readonly items?: readonly ServicePromptWire[] };
}

/** The service-prompt key the mermaid quick-fix reads (baseline `SERVICE_PROMPT_KEYS.MERMAID_QUICK_FIX`). */
export const MERMAID_QUICK_FIX_PROMPT_KEY = 'MERMAID_QUICK_FIX';

/** (2) The project's service prompts. Query-param construction mirrors `features/pipelines/api/aiAssistantConfigurations.ts`'s already-validated shape. */
export async function getServicePrompts(
  projectId: string | number,
  signal?: AbortSignal,
): Promise<ServicePromptPageWire> {
  const search = new URLSearchParams({
    include_shared: 'true',
    shared_offset: '0',
    shared_limit: '100',
    limit: '100',
    offset: '0',
    sort_by: 'created_at',
    sort_order: 'desc',
    query: '',
    section: 'service_prompts',
  });
  return fetchData<ServicePromptPageWire>(
    `/configurations/configurations/${projectId}?${search.toString()}`,
    signal ? { signal } : {},
  );
}

/** Finds the prompt text for `key` across local and shared rows. */
export function findServicePrompt(page: ServicePromptPageWire | undefined, key: string): string {
  const all = [...(page?.items ?? []), ...(page?.shared?.items ?? [])];
  const found = all.find((row) => row.data?.key === key) ?? all.find((row) => row.elitea_title === key);
  return found?.data?.prompt ?? '';
}

export interface QuickFixPredictBody {
  readonly user_input: string;
  readonly llm_settings: {
    readonly model_name: string;
    readonly model_project_id: number;
    readonly temperature: number;
  };
}

/** What blocking `predict_llm` answers with; `task_id` means it fell back to async and the answer is NOT here. */
export interface QuickFixPredictResult {
  readonly task_id?: string;
  readonly [key: string]: unknown;
}

/** (3) Blocking generation — waits up to 60s for the answer instead of streaming it over the socket. */
export async function predictQuickFix(
  projectId: string | number,
  body: QuickFixPredictBody,
  signal?: AbortSignal,
): Promise<QuickFixPredictResult> {
  return fetchData<QuickFixPredictResult>(`/elitea_core/predict_llm/prompt_lib/${projectId}`, {
    method: 'POST',
    body: JSON.stringify({
      ...body,
      chat_history: [],
      tools: [],
      instructions: null,
      await_task_timeout: 60,
    }),
    headers: { 'Content-Type': 'application/json' },
    ...(signal ? { signal } : {}),
  });
}
