/**
 * ConfigurationsPanel — displays the header with AddModelButton and all
 * configuration sections (LLM, Embedding, Vector Storage, Image, ASR, TTS,
 * AI Credentials).
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/Configuration/ConfigurationsPanel.jsx`.
 */
import { memo, useCallback, useMemo } from 'react';
import { useTheme, type Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { isPublicProject } from '@/entities/project';
import { getConfig } from '@/shared/config';
import { t } from '@/shared/ui/lib/t';

import {
  EMPTY_MODELS_RESPONSE,
  useModelsQuery,
  useSetProjectDefaultModelMutation,
  type ModelsApiResponse,
} from '../../api/ai-configuration/api';
import AddModelButton from './AddModelButton';
import ConfigurationSection, {
  type AdditionalDefaultSetting,
} from './ConfigurationSection';

/* ── types ──────────────────────────────────────────────────────────────── */

interface ConfigurationsPanelProps {
  /** Map of section name → configuration items. */
  configurationsBySection: Record<string, Record<string, unknown>[]>;
  /** Currently-selected project id — threaded down to `ConfigurationSection`
   * for edit-permission gating/click-to-edit, and used to fetch/persist
   * each section's real default model. */
  projectId: string;
  isLoading: boolean;
}

/* ── hook helper: build select options from a flat config list ──────────── */

function buildOptions(configs: readonly Record<string, unknown>[]): Array<{ value: string; label: string }> {
  return (configs ?? []).map((cfg) => {
    const name = (cfg.elitea_title as string) || (cfg.label as string) || (cfg.type as string) || '';
    return {
      value: `${String(name)}<<>>${String((cfg.project_id as string) ?? '')}`,
      label: String(name),
    };
  });
}

/** `${default_model_name}<<>>${default_model_project_id}` — matches the
 * `<<>>`-joined value shape `buildOptions` produces, so the Select can
 * find the currently-selected option by value equality. */
function defaultValueOf(data: ModelsApiResponse): string {
  return `${data.default_model_name}<<>>${data.default_model_project_id}`;
}

/** Low/high-tier defaults are optional — old app guards both halves being
 * present before building the `<<>>` value (`ModelConfiguration.jsx:168-180`),
 * otherwise leaves the Select unset rather than showing `"<<>>"`. */
function tierDefaultValueOf(name: string, tierProjectId: string): string {
  if (!name || !tierProjectId) return '';
  return `${name}<<>>${tierProjectId}`;
}

/** Tenant/public-project gating for the "Create configuration" button —
 * old app: `ALLOW_PROJECT_OWN_LLMS !== false || projectId == PUBLIC_PROJECT_ID`
 * (`ConfigurationsPanel.jsx:36-39`). Also drives `include_shared` for the
 * model-defaults fetch, matching `useListModelsQuery`'s
 * `include_shared: projectId != PUBLIC_PROJECT_ID`. Extracted to a
 * top-level function (rather than an inline `useMemo` callback) to keep
 * `ConfigurationsPanel` itself under the complexity budget. */
function computeProjectGating(projectId: string): { includeShared: boolean; canCreateConfiguration: boolean } {
  const result = getConfig();
  if (result.status !== 'ok') {
    // Defensive fallback only — `app/App.tsx` renders `MissingEnvPage`
    // before this ever mounts in production (see `integrationGuard.ts`'s
    // identical posture on this branch).
    return { includeShared: true, canCreateConfiguration: true };
  }
  const isPublic = isPublicProject(projectId, result.config.vite_public_project_id);
  return {
    includeShared: !isPublic,
    canCreateConfiguration: result.config.allow_project_own_llms !== false || isPublic,
  };
}

/** Parses a `<<>>`-joined Select value back into `name`/`targetProjectId`,
 * mirroring old app's `const [modelName, project_id] = value.split('<<>>')`
 * (`ModelConfiguration.jsx:211`). Returns `null` for an empty/unset value. */
function parseDefaultModelValue(value: string): { name: string; targetProjectId: string } | null {
  const [name, targetProjectId] = value.split('<<>>');
  if (!name) return null;
  return { name, targetProjectId: targetProjectId ?? '' };
}

/** `useModelsQuery` resolves to `undefined` before the fetch settles —
 * mirrors the old app's inline default arg on `useListModelsQuery`'s
 * destructure (`ModelConfiguration.jsx:32-45`). A plain top-level helper
 * (rather than a `??`/default-destructure at each of the 6 call sites)
 * keeps `ConfigurationsPanel` itself under the complexity budget. */
function withDefaultModels(data: ModelsApiResponse | undefined): ModelsApiResponse {
  return data ?? EMPTY_MODELS_RESPONSE;
}

/* ── component ──────────────────────────────────────────────────────────── */

export default memo(function ConfigurationsPanel({
  configurationsBySection,
  projectId,
  isLoading,
}: ConfigurationsPanelProps) {
  const theme = useTheme();
  const styles = getStyles(theme);

  /* Extract sections safely (TS doesn't know the key types) */
  const llmConfigs = configurationsBySection['llm'] ?? [];
  const embeddingConfigs = configurationsBySection['embedding'] ?? [];
  const vectorStorageConfigs = configurationsBySection['vectorstorage'] ?? [];
  const imageConfigs = configurationsBySection['image_generation'] ?? [];
  const asrConfigs = configurationsBySection['asr'] ?? [];
  const ttsConfigs = configurationsBySection['tts'] ?? [];
  const aiCredentialsConfigs = configurationsBySection['ai_credentials'] ?? [];

  const { includeShared, canCreateConfiguration } = useMemo(
    () => computeProjectGating(projectId),
    [projectId],
  );

  /* Real per-section default models — old app: 6× `useListModelsQuery`
     (`ModelConfiguration.jsx:42-78`). */
  const llmDefaults = withDefaultModels(useModelsQuery(projectId, 'llm', includeShared).data);
  const embeddingDefaults = withDefaultModels(useModelsQuery(projectId, 'embedding', includeShared).data);
  const vectorStorageDefaults = withDefaultModels(useModelsQuery(projectId, 'vectorstorage', includeShared).data);
  const imageDefaults = withDefaultModels(useModelsQuery(projectId, 'image_generation', includeShared).data);
  const asrDefaults = withDefaultModels(useModelsQuery(projectId, 'asr', includeShared).data);
  const ttsDefaults = withDefaultModels(useModelsQuery(projectId, 'tts', includeShared).data);

  const setDefaultModel = useSetProjectDefaultModelMutation(projectId);

  /* Default-setting labels with optional info tooltips (porting old-app pattern) */
  const renderInfoLabel = useCallback(
    (labelText: string) => {
      return (
        <Box sx={styles.inlineDefaultLabel}>
          <Typography
            variant="bodyMedium"
            color="text.primary"
            sx={styles.inlineDefaultLabelText}
          >
            {labelText}
          </Typography>
        </Box>
      );
    },
    [styles],
  );

  /* Compute select options directly — the config arrays come from a prop that
     may change reference every render, so useMemo would be useless (dep always changes).
     The child <ConfigurationSection> components are memoized, so unstable arrays here
     do not cause unnecessary re-renders downstream. */
  const modelOptions = buildOptions(llmConfigs);
  const lowTierOptions = buildOptions(llmConfigs.filter((c) => (c.data as Record<string, unknown>)?.low_tier));
  const highTierOptions = buildOptions(llmConfigs.filter((c) => (c.data as Record<string, unknown>)?.high_tier));
  const embeddingOptions = buildOptions(embeddingConfigs);
  const vectorStorageOptions = buildOptions(vectorStorageConfigs);
  const imageOptions = buildOptions(imageConfigs);
  const asrOptions = buildOptions(asrConfigs);
  const ttsOptions = buildOptions(ttsConfigs);

  /* Persist the project's default model for a section — old app:
     `onChangeDefaultModel(section) => value => setProjectDefaultModel(...).unwrap().catch(...)`
     (`ModelConfiguration.jsx:208-220`). */
  const handleDefaultChange = useCallback(
    (section: string) => (value: string) => {
      const parsed = parseDefaultModelValue(value);
      if (!parsed) return;
      setDefaultModel.mutate({ ...parsed, section });
    },
    [setDefaultModel],
  );

  /* LLM section needs extra low-tier / high-tier selects */
  const llmAdditionalSettings: AdditionalDefaultSetting[] = useMemo(
    () => [
      {
        key: 'high-tier-model',
        label: renderInfoLabel(t('ai-configuration.section.highTier', 'High-tier')),
        value: tierDefaultValueOf(llmDefaults.high_tier_default_model_name, llmDefaults.high_tier_default_model_project_id),
        options: highTierOptions,
        onChange: handleDefaultChange('llm_high_tier'),
      },
      {
        key: 'low-tier-model',
        label: renderInfoLabel(t('ai-configuration.section.lowTier', 'Low-tier')),
        value: tierDefaultValueOf(llmDefaults.low_tier_default_model_name, llmDefaults.low_tier_default_model_project_id),
        options: lowTierOptions,
        onChange: handleDefaultChange('llm_low_tier'),
      },
    ],
    [renderInfoLabel, highTierOptions, lowTierOptions, handleDefaultChange, llmDefaults],
  );

  return (
    <Box sx={styles.panel}>
      {/* Sticky header */}
      <Box sx={styles.header}>
        <Box sx={styles.headerContent}>
          <Typography variant="headingMedium" sx={styles.sectionTitle}>
            {t('ai-configuration.configurations.title', 'Configurations')}
          </Typography>
          {canCreateConfiguration && <AddModelButton />}
        </Box>
      </Box>

      {/* LLM Models */}
      <ConfigurationSection
        title={t('ai-configuration.section.llmModels', 'LLM Models')}
        configurations={llmConfigs}
        projectId={projectId}
        isLoading={isLoading}
        groupTheModelsByProvider
        hasDefaultSetting
        defaultSettingLabel={renderInfoLabel(t('ai-configuration.section.default', 'Default'))}
        defaultSettingValue={defaultValueOf(llmDefaults)}
        defaultSettingOptions={modelOptions}
        onChangeDefaultSetting={handleDefaultChange('llm')}
        additionalDefaultSettings={llmAdditionalSettings}
      />

      {/* Embedding Models */}
      <ConfigurationSection
        title={t('ai-configuration.section.embeddingModels', 'Embedding Models')}
        configurations={embeddingConfigs}
        projectId={projectId}
        isLoading={isLoading}
        hasDefaultSetting
        defaultSettingLabel={renderInfoLabel(t('ai-configuration.section.default', 'Default'))}
        defaultSettingValue={defaultValueOf(embeddingDefaults)}
        defaultSettingOptions={embeddingOptions}
        onChangeDefaultSetting={handleDefaultChange('embedding')}
      />

      {/* Vector Storage */}
      <ConfigurationSection
        title={t('ai-configuration.section.vectorStorage', 'Vector Storage')}
        configurations={vectorStorageConfigs}
        projectId={projectId}
        isLoading={isLoading}
        hasDefaultSetting
        defaultSettingLabel={renderInfoLabel(t('ai-configuration.section.default', 'Default'))}
        defaultSettingValue={defaultValueOf(vectorStorageDefaults)}
        defaultSettingOptions={vectorStorageOptions}
        onChangeDefaultSetting={handleDefaultChange('vectorstorage')}
      />

      {/* Image Generation */}
      <ConfigurationSection
        title={t('ai-configuration.section.imageGeneration', 'Image Generation')}
        configurations={imageConfigs}
        projectId={projectId}
        isLoading={isLoading}
        hasDefaultSetting
        defaultSettingLabel={renderInfoLabel(t('ai-configuration.section.imageDefault', 'Default image generation model:'))}
        defaultSettingValue={defaultValueOf(imageDefaults)}
        defaultSettingOptions={imageOptions}
        onChangeDefaultSetting={handleDefaultChange('image_generation')}
      />

      {/* Speech Recognition (ASR) */}
      <ConfigurationSection
        title={t('ai-configuration.section.asr', 'Speech Recognition (ASR)')}
        configurations={asrConfigs}
        projectId={projectId}
        isLoading={isLoading}
        hasDefaultSetting
        defaultSettingLabel={renderInfoLabel(t('ai-configuration.section.asrDefault', 'Default ASR model:'))}
        defaultSettingValue={defaultValueOf(asrDefaults)}
        defaultSettingOptions={asrOptions}
        onChangeDefaultSetting={handleDefaultChange('asr')}
      />

      {/* Text to Speech (TTS) */}
      <ConfigurationSection
        title={t('ai-configuration.section.tts', 'Text to Speech (TTS)')}
        configurations={ttsConfigs}
        projectId={projectId}
        isLoading={isLoading}
        hasDefaultSetting
        defaultSettingLabel={renderInfoLabel(t('ai-configuration.section.ttsDefault', 'Default TTS model:'))}
        defaultSettingValue={defaultValueOf(ttsDefaults)}
        defaultSettingOptions={ttsOptions}
        onChangeDefaultSetting={handleDefaultChange('tts')}
      />

      {/* AI Credentials */}
      <ConfigurationSection
        title={t('ai-configuration.section.aiCredentials', 'AI Credentials')}
        configurations={aiCredentialsConfigs}
        projectId={projectId}
        isLoading={isLoading}
      />
    </Box>
  );
});

function getStyles(theme: ReturnType<typeof useTheme>) {
  const t = theme as Theme;
  return {
    panel: {
      flex: 1,
      minHeight: 0,
      overflow: 'auto',
      height: '100%',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      position: 'sticky',
      top: 0,
      backgroundColor: t.vars.palette.background.eliteaDefault,
      borderBottom: `1px solid ${t.vars.palette.border.lines}`,
      zIndex: 1,
      width: '100%',
      height: '3.8125rem',
    },
    headerContent: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      background: t.vars.palette.background.eliteaDefault,
      width: '100%',
      padding: '1rem 1.5rem',
    },
    sectionTitle: {
      color: t.vars.palette.text.secondary,
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
    },
    inlineDefaultLabel: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.25rem',
    },
    inlineDefaultLabelText: {
      fontWeight: 500,
      whiteSpace: 'nowrap',
    },
  };
}
