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
 * A catalogue row's identity, as the Go catalogue itself defines it.
 *
 * `(project_id, name)` is the dedupe key `deduplicateCurrentModelItems`
 * (`internal/application/configurations/models.go`) builds its index on, and
 * with `include_shared=true` a project-local row and a shared one may
 * legitimately carry the SAME name. The LLM catalogue rows carry no `id`
 * field at all, so `toLlmModel` falls back to `id: raw.name` for every one of
 * them — which makes two same-named rows indistinguishable to the menu
 * (`LLMModelsMenu` keys and check-marks on `item.id`) and to anything that
 * tries to recover the clicked row afterwards. Composing the id from the
 * dedupe key is what makes "which row did the user click" answerable at all.
 */
function catalogueRowId(raw: ConfigModel): string {
  return `${String(raw.project_id)}::${raw.name}`;
}

/** The catalogue as the selector's display shape plus a row index, keyed by {@link catalogueRowId}. */
function indexCatalogue(items: readonly ConfigModel[]): {
  models: LLMModel[];
  rows: ReadonlyMap<string, ConfigModel>;
} {
  const models: LLMModel[] = [];
  const rows = new Map<string, ConfigModel>();
  for (const item of items) {
    const id = catalogueRowId(item);
    rows.set(id, item);
    models.push({ ...toLlmModel(item), id });
  }
  return { models, rows };
}

/**
 * The catalogue row behind a clicked `LLMModel`.
 *
 * By the id this widget composed for it, which is exact. The name fallback
 * exists only for a selector that hands back a RECONSTRUCTED model rather
 * than the array element it was given (`LLMModelsMenu` passes the element
 * through today) — and it applies only when exactly one row carries that
 * name, so it can never resurrect the "first same-named row wins" defect.
 * Returning `undefined` for an ambiguous name is deliberate: writing nothing
 * leaves the version on the model it already had, where writing a guess
 * moves it onto another project's.
 */
function findClickedRow(
  rows: ReadonlyMap<string, ConfigModel>,
  items: readonly ConfigModel[],
  model: LLMModel,
): ConfigModel | undefined {
  const byId = rows.get(model.id);
  if (byId !== undefined) return byId;
  const named = items.filter((item) => item.name === model.name);
  return named.length === 1 ? named[0] : undefined;
}

/**
 * The row a stored `llm_settings` names — by NAME AND PROJECT when it carries
 * a project, by name alone when it does not.
 *
 * Matching on the name alone is what this used to do, and with
 * `include_shared=true` it resolved a local `gpt-4o` and a shared `gpt-4o` to
 * whichever the catalogue happened to sort first (shared rows sort ahead of
 * project rows). That displayed the wrong row, and — because applying any
 * setting re-writes the whole profile from the row on screen — the next save
 * REWROTE `model_project_id` to the other project's id. elitea-main's
 * `selectCurrentAgentModel` matches name AND project, so the version then ran
 * on a model it had never been pointed at, or was refused.
 *
 * A pinned pair that matches nothing falls through to the default rather than
 * to a same-named row in another project, which is the server's own
 * behaviour: `internal/application/agentexecution/tools.go` substitutes the
 * catalogue default when a version names a model the project no longer
 * offers.
 */
function findPinnedRow(
  items: readonly ConfigModel[],
  pinnedName: string,
  pinnedProjectId: number | undefined,
): ConfigModel | undefined {
  if (pinnedProjectId === undefined) return items.find((item) => item.name === pinnedName);
  return items.find((item) => item.name === pinnedName && Number(item.project_id) === pinnedProjectId);
}

/**
 * The catalogue row the version actually runs on: its own pinned model, else
 * the project default.
 *
 * The three-step default is `features/settings/lib/profile/useDefaultModel
 * .ts`'s rule — the envelope's `default_model_name`, then a row flagged
 * `default`, then the first row. The `default` flag is consulted BEFORE a
 * bare name match within that first step because the server sets it on the
 * one row matching both the default name and the default project id
 * (`BuildCurrentModelCatalog`), so it is the only project-disambiguated
 * answer available here — the envelope's `default_model_project_id` is not
 * on `ConfigModelsListResponse`.
 */
function resolveEffectiveRow(
  items: readonly ConfigModel[],
  pinned: AgentLlmSettings | undefined,
  defaultName: string | undefined,
): ConfigModel | undefined {
  if (pinned !== undefined) {
    const row = findPinnedRow(items, pinned.model_name, pinned.model_project_id);
    if (row !== undefined) return row;
  }
  if (defaultName !== undefined && defaultName !== '') {
    const named =
      items.find((item) => item.name === defaultName && item.default === true) ??
      items.find((item) => item.name === defaultName);
    if (named !== undefined) return named;
  }
  return items.find((item) => item.default === true) ?? items[0];
}

/**
 * The version's settings as the dialog's own value bag — per-key, since
 * `exactOptionalPropertyTypes` rejects a carried `temperature: undefined`.
 *
 * `reasoning_effort` is forwarded so the dialog's `ReasoningSlider` opens on
 * the effort the version actually holds rather than re-seeding the default
 * one (`computeMissingDefaults`) over it.
 */
function toSelectorSettings(value: AgentLlmSettings | undefined): LLMSettingsValues {
  if (value === undefined) return {};
  return {
    max_tokens: value.max_tokens,
    ...(value.temperature === undefined ? {} : { temperature: value.temperature }),
    ...(value.reasoning_effort === undefined ? {} : { reasoning_effort: value.reasoning_effort }),
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
  const { models, rows } = useMemo(() => indexCatalogue(items), [items]);
  const effectiveRow = useMemo(
    () => resolveEffectiveRow(items, value, data?.default_model_name),
    [items, value, data?.default_model_name],
  );
  const selectedModel = useMemo(
    () => (effectiveRow === undefined ? null : { ...toLlmModel(effectiveRow), id: catalogueRowId(effectiveRow) }),
    [effectiveRow],
  );

  const handleSelectModel = useCallback(
    (model: LLMModel) => {
      // `LLMModel` drops `project_id` — it is the selector's display shape,
      // not the catalogue's — so the CLICKED row is recovered before the
      // profile is built. A bare name lookup here is what wrote the wrong
      // project's id onto the version when a shared and a local model share
      // a name; `rows` is keyed on the catalogue's own `(project_id, name)`
      // and so cannot.
      const row = findClickedRow(rows, items, model);
      if (row === undefined) return;
      const next = writeAgentLlmSettings(
        { name: row.name, projectId: row.project_id, supportsReasoning: model.supports_reasoning === true },
        value,
      );
      if (next !== undefined) onChange(next);
    },
    [rows, items, onChange, value],
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
