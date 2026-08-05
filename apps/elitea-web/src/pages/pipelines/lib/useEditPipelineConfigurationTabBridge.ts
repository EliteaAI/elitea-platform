import { useCallback, useMemo, useState } from 'react';

import type { UseFormSetValue } from 'react-hook-form';

import type { ApplicationCreationInput } from '@/entities/application-form';
import type { ConfigurationTabProps } from '@/features/pipelines';
import type { ApplicationVersionDetail } from '@/shared/api/generated/model';

import { toChatPipelineVersionDetails } from './editPipelineMappers';

/**
 * Bridges `EditPipeline.tsx`'s RHF `form` (which only models `name`/
 * `description`/`version_details.conversation_starters` —
 * `applicationCreationSchema`) into `ConfigurationTab`'s generic
 * `setFieldValue: (field: string, value: unknown) => void` contract, and
 * feeds the result of any writes it CAN'T route into the RHF form back into
 * the `versionDetails` object `ConfigurationTab` reads from — same "generic
 * `setFieldValue` shape, dispatched by known literal path" pattern
 * `pages/agents/CreateApplication.tsx`'s own `handleAgentFieldChange`
 * already established for the identical RHF/dynamic-path mismatch.
 *
 * **Only the two paths this app's `features/pipelines` code actually
 * writes are handled** (verified: `grep -rn "setFieldValue(" src/features/
 * pipelines/lib/hooks/usePipelineChat.hooks.ts src/features/pipelines/ui/
 * ConfigurationTab.tsx` — `version_details.llm_settings.<key>` and
 * `version_details.tools` are the only two real call sites in this
 * worktree). Anything else is a no-op — same disclosed "only
 * `conversation_starters` round-trips through save" gap `EditPipeline.tsx`'s
 * own doc comment already gives (`useSaveApplicationVersion` cannot carry
 * `llm_settings`/`tools` writes on this route either way, so silently
 * dropping an unknown path here loses nothing a save could have kept).
 */
export interface EditPipelineConfigurationTabBridge {
  readonly setFieldValue: (field: string, value: unknown) => void;
  readonly versionDetails: ConfigurationTabProps['versionDetails'];
}

interface PipelineVersionOverrides {
  readonly llmSettings: Readonly<Record<string, unknown>>;
  readonly tools: readonly unknown[] | undefined;
}

const EMPTY_OVERRIDES: PipelineVersionOverrides = { llmSettings: {}, tools: undefined };

const LLM_SETTINGS_FIELD_PATTERN = /^version_details\.llm_settings\.(.+)$/;

/** Overlays `overrides` (the two real call sites' accumulated writes) onto the query-fetched `versionDetails` — extracted to keep `useEditPipelineConfigurationTabBridge`'s own cyclomatic complexity under this codebase's gate. */
function applyOverrides(
  base: ConfigurationTabProps['versionDetails'],
  overrides: PipelineVersionOverrides,
): ConfigurationTabProps['versionDetails'] {
  if (!base) return base;
  const hasLlmSettingsOverride = Object.keys(overrides.llmSettings).length > 0;
  return {
    ...base,
    ...(overrides.tools !== undefined ? { tools: overrides.tools } : {}),
    ...(hasLlmSettingsOverride ? { llm_settings: { ...base.llm_settings, ...overrides.llmSettings } } : {}),
  };
}

export function useEditPipelineConfigurationTabBridge(
  activeVersion: ApplicationVersionDetail | undefined,
  setValue: UseFormSetValue<ApplicationCreationInput>,
): EditPipelineConfigurationTabBridge {
  const [overrides, setOverrides] = useState<PipelineVersionOverrides>(EMPTY_OVERRIDES);

  const setFieldValue = useCallback(
    (field: string, value: unknown) => {
      if (field === 'name' || field === 'description') {
        setValue(field, typeof value === 'string' ? value : '', { shouldValidate: true, shouldDirty: true });
        return;
      }
      if (field === 'version_details.tools') {
        setOverrides((previous) => ({ ...previous, tools: Array.isArray(value) ? value : previous.tools }));
        return;
      }
      const llmSettingsKey = LLM_SETTINGS_FIELD_PATTERN.exec(field)?.[1];
      if (llmSettingsKey) {
        setOverrides((previous) => ({ ...previous, llmSettings: { ...previous.llmSettings, [llmSettingsKey]: value } }));
      }
    },
    [setValue],
  );

  const versionDetails = useMemo(
    () => applyOverrides(toChatPipelineVersionDetails(activeVersion), overrides),
    [activeVersion, overrides],
  );

  return { setFieldValue, versionDetails };
}
