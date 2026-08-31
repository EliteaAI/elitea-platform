/**
 * model/useMermaidQuickFix.ts — the capability gate and the runner for the
 * canvas mermaid quick-fix (Canvas slice 2b), replacing
 * `CanvasEditor.jsx:322-395`'s inline `handleQuickFix`.
 *
 * ── WHAT THE BUTTON IS GATED ON, AND WHY ────────────────────────────────
 * The baseline rendered the quick-fix control unconditionally and then
 * toasted one of five errors when it could not run. Four of those five are
 * not user errors at all — they are "this deployment has not enabled the
 * feature". `ELITEA_CONFIGURATIONS_ENABLED` is `false` in a default install,
 * so `/configurations/*` does not answer, so `low_tier_default_model_name`
 * and the `MERMAID_QUICK_FIX` service-prompt row are both unreachable, so
 * every click toasts. An affordance that can never work is worse than no
 * affordance, so this hook reports `isAvailable: false` and the caller
 * renders nothing.
 *
 * `isAvailable` is true only when ALL FIVE of these hold:
 *   1. This build actually ROUTES the endpoint the fix is sent to
 *      (`hasBackendCapability('llmPredictBlocking')`). `POST /elitea_core/
 *      predict_llm/prompt_lib/{projectId}` once stood behind a nil
 *      `RouterConfig.Predictor` gate that nothing ever assigned, so it was
 *      never registered and chi 404'd it in every deployment (NOTE(#126));
 *      elitea-main now serves its blocking mode, which is the mode this fix
 *      uses. The flag is still checked FIRST and before the two configuration
 *      reads: a deployment with no LLM gateway configured still has nothing to
 *      ask, so the reads are skipped too.
 *   2. `projectId` is set (no project ⇒ no configurations scope).
 *   3. The models read answered AND `getMermaidQuickFixModelInfo` found a
 *      usable `(model_name, model_project_id)` pair — the low-tier default,
 *      else the plain default, else the first listed model.
 *   4. The service-prompt read answered AND carries a non-empty
 *      `MERMAID_QUICK_FIX` prompt. An empty prompt is treated exactly like
 *      an absent one: `buildMermaidQuickFixPrompt` over `''` sends the model
 *      the diagram and no instructions.
 *   5. The diagram is editable (`readOnly` false) — a fix that cannot be
 *      written back is not a fix.
 * A read still in flight reports `isAvailable: false` with
 * `reason: 'loading'`, so the control appears when the capability is
 * confirmed rather than flickering in and then out.
 *
 * NET EFFECT TODAY: condition 1 is false in every build, so the control never
 * renders and the runner is never reached. That is the honest outcome, not an
 * oversight — the alternative is a button that 404s on click. The port stays
 * for the reason `shared/config/backendCapabilities.ts` gives for the other
 * senders of this path: it is written, it is tested, and turning the flag on
 * in the change that mounts the route is a one-line switch.
 *
 * `reason` names WHICH condition failed, for the caller's disabled-state
 * tooltip and for tests. It is not a toast.
 */
import { useCallback, useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import { hasBackendCapability } from '@/shared/config';

import {
  MERMAID_QUICK_FIX_PROMPT_KEY,
  findServicePrompt,
  getQuickFixModels,
  getServicePrompts,
  predictQuickFix,
} from '../api/canvasQuickFix';
import type { MermaidQuickFixModelInfo } from '../lib/mermaidQuickFix';
import {
  buildMermaidQuickFixPrompt,
  extractMermaidCode,
  extractPredictText,
  getMermaidQuickFixModelInfo,
} from '../lib/mermaidQuickFix';

/** Which of the five gate conditions is not met. `null` when the capability is available. */
export type MermaidQuickFixUnavailableReason =
  /** This build serves no blocking `predict_llm` — `hasBackendCapability('llmPredictBlocking')` is false. */
  | 'no-backend'
  | 'loading'
  | 'no-project'
  | 'no-model'
  | 'no-prompt'
  | 'read-only';

export interface MermaidQuickFixCapability {
  readonly isAvailable: boolean;
  readonly reason: MermaidQuickFixUnavailableReason | null;
  /** Names the chosen model, e.g. `Quick Fix: gpt-4o-mini (low-tier)`. Empty when unavailable. */
  readonly tooltip: string;
  readonly model: MermaidQuickFixModelInfo | null;
}

export interface UseMermaidQuickFixParams {
  readonly projectId: string | number | undefined;
  readonly readOnly?: boolean | undefined;
  /** Set false to skip the two reads entirely (e.g. the canvas is not a mermaid diagram). */
  readonly enabled?: boolean | undefined;
}

export interface UseMermaidQuickFixResult {
  readonly capability: MermaidQuickFixCapability;
  /** Resolves the repaired mermaid source. Rejects with a human-readable `Error`. */
  readonly run: (params: { readonly error: string; readonly code: string }) => Promise<string>;
}

const UNAVAILABLE = { isAvailable: false, tooltip: '', model: null } as const;

/** Reads the model + service prompt, decides whether quick-fix can run at all, and runs it. */
export function useMermaidQuickFix({
  projectId,
  readOnly,
  enabled = true,
}: UseMermaidQuickFixParams): UseMermaidQuickFixResult {
  /*
   * Condition 1, and the reason the two reads below are skipped: with the
   * endpoint unrouted, asking which model and which prompt would serve it is
   * two requests spent on a question that cannot matter.
   */
  const predictServed = hasBackendCapability('llmPredictBlocking');
  const shouldRead = predictServed && enabled && projectId !== undefined && projectId !== '';

  const modelsQuery = useQuery({
    queryKey: ['chat-messages', 'canvas', 'quickFix', 'models', projectId],
    queryFn: ({ signal }) => getQuickFixModels(projectId as string | number, signal),
    enabled: shouldRead,
    retry: false,
  });

  const promptQuery = useQuery({
    queryKey: ['chat-messages', 'canvas', 'quickFix', 'servicePrompt', projectId],
    queryFn: ({ signal }) => getServicePrompts(projectId as string | number, signal),
    enabled: shouldRead,
    retry: false,
  });

  const model = useMemo(() => getMermaidQuickFixModelInfo(modelsQuery.data), [modelsQuery.data]);
  const basePrompt = useMemo(
    () => findServicePrompt(promptQuery.data, MERMAID_QUICK_FIX_PROMPT_KEY),
    [promptQuery.data],
  );

  const capability = useMemo<MermaidQuickFixCapability>(() => {
    if (readOnly === true) return { ...UNAVAILABLE, reason: 'read-only' };
    if (!predictServed) return { ...UNAVAILABLE, reason: 'no-backend' };
    if (!shouldRead) return { ...UNAVAILABLE, reason: 'no-project' };
    if (modelsQuery.isPending || promptQuery.isPending) return { ...UNAVAILABLE, reason: 'loading' };
    if (!model) return { ...UNAVAILABLE, reason: 'no-model' };
    if (basePrompt.trim() === '') return { ...UNAVAILABLE, reason: 'no-prompt' };
    return { isAvailable: true, reason: null, tooltip: model.tooltip, model };
  }, [basePrompt, model, modelsQuery.isPending, predictServed, promptQuery.isPending, readOnly, shouldRead]);

  const run = useCallback(
    async ({ error, code }: { error: string; code: string }): Promise<string> => {
      if (!capability.isAvailable || capability.model === null || projectId === undefined) {
        // Unreachable through the UI — the control is not rendered unless
        // `isAvailable`. Kept so a programmatic caller fails loudly.
        throw new Error(`Quick Fix is unavailable (${capability.reason ?? 'unknown'})`);
      }

      const response = await predictQuickFix(projectId, {
        user_input: buildMermaidQuickFixPrompt({ basePrompt, error, code }),
        llm_settings: {
          model_name: capability.model.modelName,
          model_project_id: capability.model.modelProjectId,
          temperature: 0.1,
        },
      });

      // A `task_id` means the server gave up on the 60s blocking window and
      // went async; the answer is not in this response and never arrives here.
      if (typeof response.task_id === 'string' && response.task_id !== '') {
        throw new Error('Quick Fix is taking longer than expected. Please try again.');
      }

      const newCode = extractMermaidCode(extractPredictText(response));
      if (newCode === '') throw new Error('Quick Fix did not return Mermaid code');
      return newCode;
    },
    [basePrompt, capability, projectId],
  );

  return { capability, run };
}
