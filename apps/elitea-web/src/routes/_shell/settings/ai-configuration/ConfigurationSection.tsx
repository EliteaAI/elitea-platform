/**
 * ConfigurationSection — displays a group of configurations with optional default-setting select.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/Configuration/ConfigurationSection.jsx`.
 */
import { memo, useMemo } from 'react';
import { useTheme, type Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { SingleSelect } from '@/shared/ui/SingleSelect';
import { t } from '@/shared/ui/lib/t';

import ConfigurationCard from './ConfigurationCard';

const GROUP_ORDER = ['OpenAI', 'Anthropic', 'Other LLM Providers'];

export interface AdditionalDefaultSetting {
  key?: string;
  label: React.ReactNode;
  labelWidth?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

export interface ConfigurationSectionProps {
  title: string;
  configurations: readonly Record<string, unknown>[];
  isLoading?: boolean;
  hasDefaultSetting?: boolean;
  defaultSettingLabel?: React.ReactNode;
  defaultSettingValue?: string;
  defaultSettingOptions?: Array<{ value: string; label: string }>;
  onChangeDefaultSetting?: (value: string) => void;
  additionalDefaultSettings?: AdditionalDefaultSetting[];
  groupTheModelsByProvider?: boolean;
}

function getGroupLabel(
  name: string | undefined,
  type: string | undefined,
  label: string | undefined,
): string {
  const configKey = (name || type || '').toLowerCase();
  const labelKey = (label || '').toLowerCase();

  const thirdPartyKeywords = ['azure', 'bedrock', 'vertex', 'vertexai', 'dial', 'ai_dial', 'ollama', 'hugging', 'model-router', 'postgres'];

  if (thirdPartyKeywords.some((k) => configKey.includes(k) || labelKey.includes(k))) {
    return 'Other LLM Providers';
  }

  const openaiTypes = ['open_ai', 'openai', 'gpt', 'codex mini', 'embedding-ada'];
  if (openaiTypes.some((t) => t.toLowerCase() === configKey || configKey.includes(t.toLowerCase())) || (labelKey && openaiTypes.some((t) => labelKey.includes(t.toLowerCase())))) {
    return 'OpenAI';
  }

  const anthropicTypes = ['claude', 'anthropic', 'opus', 'haiku'];
  if (anthropicTypes.some((t) => t.toLowerCase() === configKey || configKey.includes(t.toLowerCase())) || (labelKey && anthropicTypes.some((t) => labelKey.includes(t.toLowerCase())))) {
    return 'Anthropic';
  }

  return 'Other LLM Providers';
}

function sortByName(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const aData = a.data as Record<string, unknown> | undefined;
  const bData = b.data as Record<string, unknown> | undefined;
  const nameA = ((a.label as string) || (aData?.name as string) || (a.name as string) || (a.type as string) || '').toLowerCase();
  const nameB = ((b.label as string) || (bData?.name as string) || (b.name as string) || (b.type as string) || '').toLowerCase();
  return nameA.localeCompare(nameB);
}

/**
 * Groups configurations by provider label and sorts each group.
 */
function groupConfigurationsByProvider(
  configurations: Record<string, unknown>[],
  sortFn: (a: Record<string, unknown>, b: Record<string, unknown>) => number,
): Record<string, Record<string, unknown>[]> | null {
  const groups: Record<string, Record<string, unknown>[]> = {};
  for (const config of configurations) {
    const groupLabel = getGroupLabel(
      config.name as string | undefined,
      config.type as string | undefined,
      config.label as string | undefined,
    );
    if (!groups[groupLabel]) groups[groupLabel] = [];
    groups[groupLabel].push(config);
  }
  for (const groupLabel of Object.keys(groups)) {
    groups[groupLabel].sort(sortFn);
  }
  return groups;
}

/**
 * Renders ConfigurationCards for the given array of configurations.
 * Extracted to keep ConfigurationSection below the complexity budget.
 */
function ConfigCards({
  configurations,
  defaultSettingValue,
  styles,
}: {
  configurations: readonly Record<string, unknown>[];
  defaultSettingValue: string;
  styles: ReturnType<typeof getStyles>;
}) {
  return (
    <Box sx={styles.configurationsContainer}>
      {configurations.map((configuration, index) => {
        const cfg = configuration;
        const d = cfg.data as Record<string, unknown> | undefined;
        return (
          <ConfigurationCard
            key={`${(cfg.id as string) || (cfg.name as string)}-${index}`}
            configuration={configuration}
            canEdit={true}
            isDefault={defaultSettingValue === `${(d?.name as string) ?? ''}<<>>${(cfg.project_id as string) ?? ''}`}
          />
        );
      })}
    </Box>
  );
}

export default memo(function ConfigurationSection({
  title,
  configurations,
  isLoading,
  hasDefaultSetting,
  defaultSettingLabel,
  defaultSettingValue = '',
  defaultSettingOptions = [],
  onChangeDefaultSetting,
  additionalDefaultSettings = [],
  groupTheModelsByProvider = false,
}: ConfigurationSectionProps) {
  const theme = useTheme();
  const styles = getStyles(theme);

  const groupedConfigurations = useMemo(() => {
    if (!groupTheModelsByProvider || !configurations?.length) return null;
    return groupConfigurationsByProvider(configurations, sortByName);
  }, [configurations, groupTheModelsByProvider]);

  const sortedConfigurations = useMemo(() => {
    if (groupTheModelsByProvider) return configurations;
    return [...(configurations || [])].sort(sortByName);
  }, [configurations, groupTheModelsByProvider]);

  if (isLoading) {
    return (
      <Box sx={styles.container}>
        <Typography variant="headingSmall" sx={styles.title}>{title}</Typography>
        <Typography variant="bodyMedium">{t('ai-configuration.section.loading', 'Loading...')}</Typography>
      </Box>
    );
  }

  if (!configurations || configurations.length === 0) return null;

  return (
    <ConfigurationSectionBody
      title={title}
      styles={styles}
      hasDefaultSetting={hasDefaultSetting}
      defaultSettingValue={defaultSettingValue}
      defaultSettingLabel={defaultSettingLabel}
      defaultSettingOptions={defaultSettingOptions}
      onChangeDefaultSetting={onChangeDefaultSetting}
      additionalDefaultSettings={additionalDefaultSettings}
      groupTheModelsByProvider={groupTheModelsByProvider}
      groupedConfigurations={groupedConfigurations}
      sortedConfigurations={sortedConfigurations}
    />
  );
});

function ConfigurationSectionBody({
  title, styles, hasDefaultSetting, defaultSettingValue,
  defaultSettingLabel, defaultSettingOptions, onChangeDefaultSetting,
  additionalDefaultSettings, groupTheModelsByProvider,
  groupedConfigurations, sortedConfigurations,
}: {
  title: string;
  styles: ReturnType<typeof getStyles>;
  hasDefaultSetting?: boolean;
  defaultSettingValue: string;
  defaultSettingLabel?: React.ReactNode;
  defaultSettingOptions?: Array<{ value: string; label: string }>;
  onChangeDefaultSetting?: (value: string) => void;
  additionalDefaultSettings?: AdditionalDefaultSetting[];
  groupTheModelsByProvider?: boolean;
  groupedConfigurations?: Record<string, Record<string, unknown>[]> | null;
  sortedConfigurations?: readonly Record<string, unknown>[];
}) {
  return (
    <Box sx={styles.container}>
      <Typography variant="headingSmall" sx={styles.title}>{title}</Typography>

      {hasDefaultSetting && (
        <DefaultSettingsSelects
          defaultSettingValue={defaultSettingValue}
          defaultSettingLabel={defaultSettingLabel}
          defaultSettingOptions={defaultSettingOptions}
          onChangeDefaultSetting={onChangeDefaultSetting}
          additionalDefaultSettings={additionalDefaultSettings}
        />
      )}

      {groupTheModelsByProvider && groupedConfigurations ? (
        GROUP_ORDER.map((groupLabel) => {
          const groupConfigs = groupedConfigurations[groupLabel] ?? [];
          if (groupConfigs.length === 0) return null;
          return (
            <Box key={groupLabel} sx={styles.groupContainer}>
              <Typography variant="subtitle" color="text.primary">{groupLabel}</Typography>
              <ConfigCards
                configurations={groupConfigs}
                defaultSettingValue={defaultSettingValue}
                styles={styles}
              />
            </Box>
          );
        })
      ) : (
        <ConfigCards
          configurations={sortedConfigurations ?? []}
          defaultSettingValue={defaultSettingValue}
          styles={styles}
        />
      )}
    </Box>
  );
}

function DefaultSettingsSelects({
  defaultSettingValue, defaultSettingLabel, defaultSettingOptions,
  onChangeDefaultSetting, additionalDefaultSettings,
}: {
  defaultSettingValue: string;
  defaultSettingLabel?: React.ReactNode;
  defaultSettingOptions?: Array<{ value: string; label: string }>;
  onChangeDefaultSetting?: (value: string) => void;
  additionalDefaultSettings?: AdditionalDefaultSetting[];
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexWrap: 'nowrap', alignItems: 'stretch', justifyContent: 'flex-start', gap: '1.5rem' }}>
      <SingleSelect
        label={typeof defaultSettingLabel === 'string' ? defaultSettingLabel : ''}
        value={defaultSettingValue}
        onChange={onChangeDefaultSetting || (() => {})}
        options={defaultSettingOptions ?? []}
        disabled={false}
      />
      {additionalDefaultSettings
        ?.filter((s): s is NonNullable<typeof s> => Boolean(s))
        .map((setting) => (
          <SingleSelect
            key={setting.key ?? String(setting.label as string ?? 'additional')}
            label={typeof setting.label === 'string' ? setting.label : ''}
            value={setting.value ?? ''}
            onChange={setting.onChange ?? (() => {})}
            options={setting.options ?? []}
            disabled={false}
          />
        ))}
    </Box>
  );
}

function getStyles(theme: ReturnType<typeof useTheme>) {
  const t = theme as Theme;
  return {
    container: {
      padding: '1rem 1.5rem',
      gap: '0.5rem',
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
    },
    title: {
      color: t.vars.palette.text.secondary,
    },
    defaultSettingsContainer: {
      display: 'flex',
      flexDirection: 'column',
      flexWrap: 'nowrap',
      alignItems: 'stretch',
      justifyContent: 'flex-start',
      gap: '1.5rem',
    },
    configurationsContainer: {
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: '0.75rem',
      justifyContent: 'flex-start',
    },
    groupContainer: {
      display: 'flex',
      flexDirection: 'column',
      paddingTop: '.5rem',
      paddingBottom: '1rem',
      borderBottom: `1px solid ${t.vars.palette.border.lines}`,
    },
  };
}
