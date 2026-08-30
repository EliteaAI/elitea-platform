/**
 * The AI-configuration `ModelConfiguration` layer (issue #80).
 *
 * The baseline renders the settings page as three levels:
 * `pages/settings/AIConfiguration.jsx` -> `Configuration/ModelConfiguration.jsx`
 * -> (`ProjectAIConfiguration`, `ConfigurationsPanel`, `ModelCapabilitiesSection`).
 * This app ported the leaves and skipped the middle level, so the capability
 * chips and the copy-configuration button had no host and no caller.
 *
 * This hook is that middle level, minus the parts the port already covers:
 * `ConfigurationsPanel` in this app fetches its own per-section defaults and
 * builds its own select options, so the baseline's nine `useModelOptions` lists
 * have no consumer here. What the chips actually need is only the LLM
 * catalogue, the auto-selected model, and the grouped option map — which is
 * what this hook builds.
 */
import { useCallback, useMemo } from 'react';

import { isPublicProject } from '@/entities/project';
import { getConfig } from '@/shared/config';

import { useModelsQuery } from '../../api/ai-configuration/api';

import {
  buildConfigurationData,
  getConfigurationOptions,
  getModelCapabilities,
  removeDuplicateModels,
} from './modelConfiguration.helpers';
import { useModelConfiguration } from './useModelConfiguration';

export interface ModelConfigurationLayerParams {
  /** The project the user works in — the project that pays for a `/llm` call. */
  readonly projectId: string;
  /** `shared/config`'s `vite_server_url`, the baseline's `state.user.api_url`. */
  readonly userApiUrl: string;
  /** The section map the page already holds, reused for the copied payload. */
  readonly configurationsBySection: Record<string, unknown[]> | null;
}

export interface ModelConfigurationLayer {
  /** Display labels for `ModelCapabilitiesSection`. Empty hides the section. */
  readonly capabilities: readonly string[];
  /** Writes the whole card as JSON to the clipboard. */
  readonly copyConfiguration: () => void;
}

/**
 * `include_shared: projectId != PUBLIC_PROJECT_ID` — the same test
 * `ConfigurationsPanel` and `OpenAITemplate` apply to the same route, so the
 * three share one react-query cache entry instead of fetching three times.
 */
function includeSharedFor(projectId: string): boolean {
  const result = getConfig();
  if (result.status !== 'ok') return true;
  return !isPublicProject(projectId, result.config.vite_public_project_id);
}

export function useModelConfigurationLayer({
  projectId,
  userApiUrl,
  configurationsBySection,
}: ModelConfigurationLayerParams): ModelConfigurationLayer {
  const includeShared = useMemo(() => includeSharedFor(projectId), [projectId]);

  /* The MODEL CATALOGUE, not the configuration list: only the catalogue
     carries the per-model capability flags and the real `default` flag. */
  const { data: catalogue } = useModelsQuery(projectId, 'llm', includeShared);

  const uniqueConfigurations = useMemo(
    () => removeDuplicateModels(catalogue ? [...catalogue.items] : []),
    [catalogue],
  );

  /* The selected model. There is no selector on this tab in the baseline
     either: `useModelConfiguration` auto-selects the project's default model,
     and the chips describe that model. */
  const { model } = useModelConfiguration({ projectId, configurations: uniqueConfigurations });

  const options = useMemo(() => getConfigurationOptions(uniqueConfigurations), [uniqueConfigurations]);

  const capabilities = useMemo(
    () => getModelCapabilities(options, model.configuration_uid, model.model_name),
    [options, model.configuration_uid, model.model_name],
  );

  const copyConfiguration = useCallback(() => {
    const payload = buildConfigurationData({
      userApiUrl,
      projectId,
      model,
      configurationsBySections: (configurationsBySection ?? {}) as Record<string, Array<Record<string, unknown>>>,
      uniqueConfigurations: uniqueConfigurations as unknown as Array<Record<string, unknown>>,
    });
    /* The clipboard write is the whole action. It rejects only when the
       browser denies clipboard access, which leaves nothing to roll back and
       nothing to retry, so the rejection is absorbed — the same posture as
       `OpenAITemplate`'s copy button. */
    void navigator.clipboard?.writeText(JSON.stringify(payload, null, 2)).catch(() => undefined);
  }, [configurationsBySection, model, projectId, uniqueConfigurations, userApiUrl]);

  return { capabilities, copyConfiguration };
}
