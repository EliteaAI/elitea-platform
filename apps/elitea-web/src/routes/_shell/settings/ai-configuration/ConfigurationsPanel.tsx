/**
 * ConfigurationsPanel — displays the header with AddModelButton and all
 * configuration sections (LLM, Embedding, Vector Storage, Image, ASR, TTS,
 * AI Credentials).
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/Configuration/ConfigurationsPanel.jsx`.
 */
import { memo, useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/ui/lib/t';

import AddModelButton from './AddModelButton';
import ConfigurationSection, {
  type AdditionalDefaultSetting,
} from './ConfigurationSection';

/* ── types ──────────────────────────────────────────────────────────────── */

interface ConfigurationsPanelProps {
  /** Map of section name → configuration items. */
  configurationsBySection: Record<string, Record<string, unknown>[]>;
  isLoading: boolean;
}

/* ── hook helper: build select options from a flat config list ──────────── */

function buildOptions(configs: readonly Record<string, unknown>[]): Array<{ value: string; label: string }> {
  return (configs ?? []).map((cfg) => ({
    value: `${(cfg.elitea_title as string || cfg.label as string || cfg.type as string) as string}<<>>${cfg.project_id as string}`,
    label: cfg.elitea_title as string || cfg.label as string || cfg.type as string || '',
  }));
}

/* ── component ──────────────────────────────────────────────────────────── */

export default memo(function ConfigurationsPanel({
  configurationsBySection,
  isLoading,
}: ConfigurationsPanelProps) {
  const styles = getStyles();

  /* Extract sections safely (TS doesn't know the key types) */
  const llmConfigs = (configurationsBySection['llm'] ?? []) as Record<string, unknown>[];
  const embeddingConfigs = (configurationsBySection['embedding'] ?? []) as Record<string, unknown>[];
  const vectorStorageConfigs = (configurationsBySection['vectorstorage'] ?? []) as Record<string, unknown>[];
  const imageConfigs = (configurationsBySection['image_generation'] ?? []) as Record<string, unknown>[];
  const asrConfigs = (configurationsBySection['asr'] ?? []) as Record<string, unknown>[];
  const ttsConfigs = (configurationsBySection['tts'] ?? []) as Record<string, unknown>[];
  const aiCredentialsConfigs = (configurationsBySection['ai_credentials'] ?? []) as Record<string, unknown>[];

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

  const handleDefaultChange = useCallback(
    (section: string) => (value: string) => {
      // In a full implementation this would call an API mutation to set
      // the project's default model for this section. For now it's a
      // placeholder — the select is wired but doesn't persist.
      void value;
      void section;
    },
    [],
  );

  /* LLM section needs extra low-tier / high-tier selects */
  const llmAdditionalSettings: AdditionalDefaultSetting[] = useMemo(
    () => [
      {
        key: 'high-tier-model',
        label: renderInfoLabel(t('ai-configuration.section.highTier', 'High-tier')),
        value: '',
        options: highTierOptions,
        onChange: handleDefaultChange('llm_high_tier'),
      },
      {
        key: 'low-tier-model',
        label: renderInfoLabel(t('ai-configuration.section.lowTier', 'Low-tier')),
        value: '',
        options: lowTierOptions,
        onChange: handleDefaultChange('llm_low_tier'),
      },
    ],
    [renderInfoLabel, highTierOptions, lowTierOptions, handleDefaultChange],
  );

  return (
    <Box sx={styles.panel}>
      {/* Sticky header */}
      <Box sx={styles.header}>
        <Box sx={styles.headerContent}>
          <Typography variant="headingMedium" sx={styles.sectionTitle}>
            {t('ai-configuration.configurations.title', 'Configurations')}
          </Typography>
          <AddModelButton />
        </Box>
      </Box>

      {/* LLM Models */}
      <ConfigurationSection
        title={t('ai-configuration.section.llmModels', 'LLM Models')}
        configurations={llmConfigs}
        isLoading={isLoading}
        groupTheModelsByProvider
        hasDefaultSetting
        defaultSettingLabel={renderInfoLabel(t('ai-configuration.section.default', 'Default'))}
        defaultSettingValue=""
        defaultSettingOptions={modelOptions}
        onChangeDefaultSetting={handleDefaultChange('llm')}
        additionalDefaultSettings={llmAdditionalSettings}
      />

      {/* Embedding Models */}
      <ConfigurationSection
        title={t('ai-configuration.section.embeddingModels', 'Embedding Models')}
        configurations={embeddingConfigs}
        isLoading={isLoading}
        hasDefaultSetting
        defaultSettingLabel={renderInfoLabel(t('ai-configuration.section.default', 'Default'))}
        defaultSettingValue=""
        defaultSettingOptions={embeddingOptions}
        onChangeDefaultSetting={handleDefaultChange('embedding')}
      />

      {/* Vector Storage */}
      <ConfigurationSection
        title={t('ai-configuration.section.vectorStorage', 'Vector Storage')}
        configurations={vectorStorageConfigs}
        isLoading={isLoading}
        hasDefaultSetting
        defaultSettingLabel={renderInfoLabel(t('ai-configuration.section.default', 'Default'))}
        defaultSettingValue=""
        defaultSettingOptions={vectorStorageOptions}
        onChangeDefaultSetting={handleDefaultChange('vectorstorage')}
      />

      {/* Image Generation */}
      <ConfigurationSection
        title={t('ai-configuration.section.imageGeneration', 'Image Generation')}
        configurations={imageConfigs}
        isLoading={isLoading}
        hasDefaultSetting
        defaultSettingLabel={renderInfoLabel(t('ai-configuration.section.imageDefault', 'Default image generation model:'))}
        defaultSettingValue=""
        defaultSettingOptions={imageOptions}
        onChangeDefaultSetting={handleDefaultChange('image_generation')}
      />

      {/* Speech Recognition (ASR) */}
      <ConfigurationSection
        title={t('ai-configuration.section.asr', 'Speech Recognition (ASR)')}
        configurations={asrConfigs}
        isLoading={isLoading}
        hasDefaultSetting
        defaultSettingLabel={renderInfoLabel(t('ai-configuration.section.asrDefault', 'Default ASR model:'))}
        defaultSettingValue=""
        defaultSettingOptions={asrOptions}
        onChangeDefaultSetting={handleDefaultChange('asr')}
      />

      {/* Text to Speech (TTS) */}
      <ConfigurationSection
        title={t('ai-configuration.section.tts', 'Text to Speech (TTS)')}
        configurations={ttsConfigs}
        isLoading={isLoading}
        hasDefaultSetting
        defaultSettingLabel={renderInfoLabel(t('ai-configuration.section.ttsDefault', 'Default TTS model:'))}
        defaultSettingValue=""
        defaultSettingOptions={ttsOptions}
        onChangeDefaultSetting={handleDefaultChange('tts')}
      />

      {/* AI Credentials */}
      <ConfigurationSection
        title={t('ai-configuration.section.aiCredentials', 'AI Credentials')}
        configurations={aiCredentialsConfigs}
        isLoading={isLoading}
      />
    </Box>
  );
});

function getStyles() {
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
      backgroundColor: '#1a1b26',
      borderBottom: '1px solid #292e42',
      zIndex: 1,
      width: '100%',
      height: '3.8125rem',
    },
    headerContent: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      background: '#1a1b26',
      width: '100%',
      padding: '1rem 1.5rem',
    },
    sectionTitle: {
      color: '#9ca3af',
      fontWeight: 600,
      fontSize: '1rem',
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
