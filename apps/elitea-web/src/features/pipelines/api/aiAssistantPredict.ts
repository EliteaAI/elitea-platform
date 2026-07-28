/**
 * features/pipelines/api/aiAssistantPredict.ts — hand-written endpoint
 * layer for the LLM-generation endpoints the AI Assistant panel drives
 * (unit A2a; new manifest entries `pipelines.generateContentStreaming` /
 * `pipelines.stopLlmTask`).
 *
 * WHY HAND-WRITTEN, NOT GENERATED: no `predict_llm`/`task` operation
 * appears anywhere under `src/shared/api/generated/**` or
 * `src/shared/api/endpoints.manifest.json` (grepped both — confirmed
 * absent as of this unit's landing; the mission preamble's REAL BACKEND
 * GAPS section documents the sibling `predict`/`webchat` endpoints'
 * narrower generated shape but does not mention this one, so this was
 * independently re-verified here). The Go route DOES exist and IS wired —
 * `services/elitea-main/internal/api/router.go:427-429`:
 *   `r.Post("/predict_llm/prompt_lib/{projectID}", predictHandler.Predict)`
 *   `r.Delete("/task/prompt_lib/{projectID}/{taskID}", predictHandler.CancelTask)`
 * — gated behind `cfg.Indexer.Predictor != nil`, the same predictor used by
 * `/predict`/`/webchat` (`shared/api/generated/chat/chat.ts`'s
 * `webchatSync`). Per R-A5 ("every network call must go through a
 * generated or hand-registered endpoint … and appear in
 * `endpoints.manifest.json`"), the 2 fetchers below call `eliteaFetch` (the
 * same transport every generated hook uses — no new `fetch`/
 * `XMLHttpRequest` site, R-A1/R-A4 untouched) and this unit appended 2
 * `source:"handwritten"` entries to `endpoints.manifest.json`.
 *
 * Ported from `apps/elitea-ui/src/api/llm.js`'s `generateContentStreaming`/
 * `stopLlmTask` RTK Query endpoints (URL/body shape byte-for-byte
 * identical); `generateContentBlocking` is NOT ported — grepped, zero call
 * sites anywhere under the ai-assistant sub-unit's owned files
 * (`useAIContentGenerationStreaming.hooks.js` only ever calls the
 * streaming variant), so it would be a dead export under `knip
 * --max-issues 0`.
 *
 * Response shape: the streaming mutation's HTTP response only ever needs
 * to signal an immediate rejection (`{error: string}` — the same shape
 * `useAIContentGenerationStreaming.hooks.js:296` checks,
 * `if (result?.error) throw new Error(result.error)`); the real generated
 * content arrives over the `application_predict` socket event
 * (`shared/api/socket/events.ts`), not in this HTTP response body — this
 * is the documented non-blocking mode (`await_task_timeout: 0`).
 */
import { eliteaFetch } from '@/shared/api/generated/mutator';

async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options);
  return envelope.data;
}

/** LLM sampling settings sent alongside the prompt — mirrors `modelConfig` fields the AI Assistant panel reads off the pipeline's LLM node. */
export interface AiAssistantLlmSettings {
  readonly model_name: string;
  readonly integration_uid?: string;
  readonly temperature: number;
  readonly max_tokens: number;
}

export interface GenerateContentStreamingBody {
  readonly message_id: string;
  readonly stream_id: string;
  readonly user_input: string;
  readonly chat_history: readonly unknown[];
  readonly llm_settings: AiAssistantLlmSettings;
}

/** The streaming mutation's immediate HTTP response — real content streams over the socket (see file header). `error` is present only when the backend rejects the request outright before any streaming starts. */
export interface GenerateContentStreamingResult {
  readonly error?: string;
  readonly [key: string]: unknown;
}

/**
 * `POST /elitea_core/predict_llm/prompt_lib/{projectId}` — non-blocking
 * mode (`await_task_timeout: 0`): the server starts the run and streams its
 * output back over socket.io under the caller-supplied `sid`
 * (`shared/api/socket/events.ts`'s `application_predict`, receive
 * direction) instead of returning it in this response.
 */
export async function generateContentStreaming(
  projectId: string | number,
  sid: string,
  body: GenerateContentStreamingBody,
): Promise<GenerateContentStreamingResult> {
  return fetchData<GenerateContentStreamingResult>(`/elitea_core/predict_llm/prompt_lib/${projectId}`, {
    method: 'POST',
    body: JSON.stringify({ ...body, sid, await_task_timeout: 0 }),
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * `DELETE /elitea_core/task/prompt_lib/{projectId}/{taskId}` — cancels an
 * in-flight generation (`stream_id`/`message_id` from the streaming call
 * doubles as the task id, matching the baseline's
 * `stopLlmTask({projectId, task_id: streamId})` call site).
 */
export async function stopLlmTask(projectId: string | number, taskId: string): Promise<unknown> {
  return fetchData<unknown>(`/elitea_core/task/prompt_lib/${projectId}/${taskId}`, { method: 'DELETE' });
}
