/**
 * The model an agent or pipeline version runs on, as a control its author
 * can use.
 *
 * This is a widget rather than part of the agent form because it is the one
 * place allowed to touch both sides of the problem: the project's model
 * catalogue (`shared/api/configurationsApi`) and the existing control set in
 * `widgets/llm-model-selector`. `.dependency-cruiser.cjs` forbids
 * `features/` importing `widgets/`, so the form takes it as an injected
 * `modelSettingsSlot` — the same shape `features/agents/ui/AgentEditor.tsx`
 * already uses for `renderLlmModelSelector`.
 *
 * **It emits only on a deliberate act.** A version whose `llm_settings` is
 * `{}` runs today because elitea-main falls back to the project catalogue
 * default, and that fallback is why agent chat works at all. So this control
 * SHOWS that default as the effective model but writes nothing until the
 * user picks a model or applies settings, and `writeAgentLlmSettings`
 * refuses to build a profile it cannot complete. Rendering a value is not
 * the same as authoring one.
 */
import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { AgentLlmSettings } from '@/shared/api/agentLlmSettings';
import { useListModelsQuery, type ConfigModel } from '@/shared/api/configurationsApi';
import { t } from '@/shared/i18n';
import { InfoLabelWithTooltip } from '@/shared/ui/InfoLabelWithTooltip';
import { LLMModelSelector, toLlmModel, type LLMModel, type LLMSettingsValues } from '@/widgets/llm-model-selector';

import { writeAgentLlmSettings } from '../lib/writeAgentLlmSettings';

export interface AgentModelSettingsProps {
  /** The project whose catalogue is offered. `undefined` disables the control — there is no catalogue to pick from. */
  readonly projectId: string | undefined;
  /** The version's stored settings, or `undefined` when it carries none and runs on the project default. */
  readonly value: AgentLlmSettings | undefined;
  readonly onChange: (next: AgentLlmSettings) => void;
  readonly disabled?: boolean | undefined;
}

/**
 * The catalogue row the version actually runs on: its own pinned model, else
 * the project default.
 *
 * The three-step default is `features/settings/lib/profile/useDefaultModel
 * .ts`'s rule — the envelope's `default_model_name`, then a row flagged
 * `default`, then the first row — and the fall-through for a pinned name
 * that is no longer in the catalogue is the server's own behaviour:
 * `internal/application/agentexecution/tools.go` substitutes the catalogue
 * default when a version names a model the project no longer offers. Showing
 * the pinned-but-missing name instead would put a model on screen that
 * nothing will run.
 */
function resolveEffectiveRow(
  items: readonly ConfigModel[],
  pinnedName: string | undefined,
  defaultName: string | undefined,
): ConfigModel | undefined {
  if (pinnedName !== undefined) {
    const pinned = items.find((item) => item.name === pinnedName);
    if (pinned !== undefined) return pinned;
  }
  if (defaultName !== undefined && defaultName !== '') {
    const named = items.find((item) => item.name === defaultName);
    if (named !== undefined) return named;
  }
  return items.find((item) => item.default === true) ?? items[0];
}

/** The version's settings as the dialog's own value bag — per-key, since `exactOptionalPropertyTypes` rejects a carried `temperature: undefined`. */
function toSelectorSettings(value: AgentLlmSettings | undefined): LLMSettingsValues {
  if (value === undefined) return {};
  return {
    max_tokens: value.max_tokens,
    ...(value.temperature === undefined ? {} : { temperature: value.temperature }),
  };
}

export function AgentModelSettings({ projectId, value, onChange, disabled = false }: AgentModelSettingsProps): ReactNode {
  // Deliberately the query the chat composer already runs
  // (`widgets/chat-box/ui/hooks/useChatBoxModelSelection.ts`): same call,
  // same `['models', projectId]` key, so opening an agent for edit beside a
  // chat reuses one cached catalogue instead of refetching it.
  const { data } = useListModelsQuery(
    { projectId: projectId ?? '', include_shared: true },
    { enabled: projectId !== undefined },
  );
  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const models = useMemo(() => items.map(toLlmModel), [items]);
  const effectiveRow = useMemo(
    () => resolveEffectiveRow(items, value?.model_name, data?.default_model_name),
    [items, value?.model_name, data?.default_model_name],
  );
  const selectedModel = useMemo(() => (effectiveRow === undefined ? null : toLlmModel(effectiveRow)), [effectiveRow]);

  const handleSelectModel = useCallback(
    (model: LLMModel) => {
      // `LLMModel` drops `project_id` — it is the selector's display shape,
      // not the catalogue's — so the chosen row is looked up again to
      // recover it, the same recovery the chat composer does.
      const row = items.find((item) => item.name === model.name);
      const next = writeAgentLlmSettings(
        { name: model.name, projectId: row?.project_id, supportsReasoning: model.supports_reasoning === true },
        value,
      );
      if (next !== undefined) onChange(next);
    },
    [items, onChange, value],
  );

  const handleSetSettings = useCallback(
    (settings: LLMSettingsValues) => {
      if (effectiveRow === undefined) return;
      // Applying settings pins the model too. The user changed a knob on a
      // specific model, and a settings object without a model is not one the
      // worker accepts.
      const next = writeAgentLlmSettings(
        {
          name: effectiveRow.name,
          projectId: effectiveRow.project_id,
          supportsReasoning: selectedModel?.supports_reasoning === true,
        },
        settings,
      );
      if (next !== undefined) onChange(next);
    },
    [effectiveRow, onChange, selectedModel],
  );

  const isDisabled = disabled || projectId === undefined;

  return (
    <Box sx={containerSx}>
      <InfoLabelWithTooltip
        label={t('widgets.agentModelSettings.label', 'Model')}
        tooltip={t(
          'widgets.agentModelSettings.tooltip',
          'The model this version runs on. Leave it untouched to follow the project default.',
        )}
        variant="bodyMedium"
      />
      <LLMModelSelector
        models={models}
        selectedModel={selectedModel}
        onSelectModel={handleSelectModel}
        llmSettings={toSelectorSettings(value)}
        disabled={isDisabled}
        // The agent's step limit lives in `version_details.meta` and
        // `features/agents/ui/ApplicationAdvanceSettings.tsx` — the very
        // panel this control is rendered inside — already owns it. A second
        // input for it here would be two writers for one field.
        showStepsLimit={false}
        // Withheld rather than passed-and-ignored: `LLMModelSelector` reads
        // this prop's presence to decide whether the settings gear is
        // interactive at all.
        {...(isDisabled ? {} : { onSetLLMSettings: handleSetSettings })}
      />
    </Box>
  );
}

const containerSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  alignItems: 'flex-start',
};
