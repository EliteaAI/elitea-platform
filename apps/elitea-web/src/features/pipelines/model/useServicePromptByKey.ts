import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { getConfigurationsList } from '../api/aiAssistantConfigurations';
import type { AiAssistantConfigurationPageWire, AiAssistantConfigurationWire } from '../api/aiAssistantConfigurations';

/**
 * Local port of `apps/elitea-ui/src/hooks/useServicePromptByKey.js`
 * (baseline, 37 lines) — unit A2a. Not one of this sub-unit's owned
 * old-app files (it lives at `hooks/`, project-root-level, not under
 * `[fsd]/features/pipelines/ai-assistant/`), but `useAIContentGenerationStreaming.
 * hooks.js:14,51` (an owned file) depends on it directly, and the workflow
 * preamble's "duplicate locally rather than reach across a slice boundary"
 * precedent applies the same way it does to `./useAiAssistantLanguageLinter.ts`.
 *
 * Substitutes RTK Query's `useGetConfigurationsListQuery` for TanStack
 * Query's `useQuery` over `../api/aiAssistantConfigurations.ts`'s local
 * `getConfigurationsList` (spec §2.3 — no Redux/RTK Query anywhere in the
 * new app).
 *
 * DEVIATION FROM BASELINE (`includeShared`): the baseline passes
 * `includeShared: projectId != PUBLIC_PROJECT_ID` — shared service prompts
 * are excluded only when the CURRENT project IS itself the public/
 * marketplace project (avoiding a project seeing its own shared entries
 * twice). Reproducing that requires `shared/config`'s runtime
 * `vite_public_project_id` plus `entities/project`'s `isPublicProject`
 * plumbing threaded all the way from a route/page caller down into this
 * hook — machinery this ai-assistant sub-unit does not own the wiring for,
 * and the panel is usable app-wide, not scoped to the public project's own
 * pages. `includeShared` is always `true` here; the only observable
 * difference is that a caller running INSIDE the public project itself may
 * see its own shared prompts listed twice in `data.items`/`data.shared.items`
 * — harmless for this hook's actual read (`prompt` text lookup by `key`,
 * see `find` below, which is a `find`, not a count).
 */

// Baseline's `SERVICE_PROMPT_KEYS` constant (only `MERMAID_QUICK_FIX`) is
// NOT ported here — it belongs to a different, unrelated feature (a
// mermaid-diagram quick-fix caller of this same hook), not the AI Assistant
// panel this sub-unit owns; nothing in this sub-unit's owned files
// references it, so re-declaring it would be a dead export under `knip
// --max-issues 0` (R-D1). Whichever sub-unit owns that caller should
// re-add its own copy per this codebase's "duplicate locally" precedent.

export interface UseServicePromptByKeyResult {
  readonly config: AiAssistantConfigurationWire | null;
  readonly prompt: string;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly error: Error | null;
}

function findServicePromptConfig(
  data: AiAssistantConfigurationPageWire | undefined,
  key: string,
): AiAssistantConfigurationWire | null {
  const locals = data?.items ?? [];
  const shared = data?.shared?.items ?? [];
  const all = [...locals, ...shared];
  return all.find((item) => item.data?.key === key) ?? all.find((item) => item.elitea_title === key) ?? null;
}

/**
 * Reads the Service Prompt config (if one has been created) for a given
 * `key`, in the `service_prompts` section. Used by `useAIContentGenerationStreaming`
 * to source the AI Assistant's base prompt from backend configuration
 * rather than hardcoding it in the UI.
 */
export function useServicePromptByKey(
  projectId: string | number | undefined,
  key: string | null,
): UseServicePromptByKeyResult {
  const query: UseQueryResult<AiAssistantConfigurationPageWire> = useQuery({
    queryKey: ['pipelines', 'aiAssistant', 'servicePrompt', projectId, key],
    queryFn: ({ signal }) =>
      getConfigurationsList(
        { projectId: projectId as string | number, section: 'service_prompts', includeShared: true, pageSize: 100 },
        signal,
      ),
    enabled: projectId !== undefined && projectId !== null && key !== null && key !== '',
  });

  const { config, prompt } = useMemo(() => {
    if (key === null) return { config: null, prompt: '' };
    const found = findServicePromptConfig(query.data, key);
    return { config: found, prompt: (found?.data?.prompt as string | undefined) ?? '' };
  }, [query.data, key]);

  return {
    config,
    prompt,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}
