/**
 * ConfigurationSection — displays a group of configurations with optional default-setting select.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/Configuration/ConfigurationSection.jsx`.
 */
import { memo, useMemo } from 'react';

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
  const configKey = ((name || type || '') as string).toLowerCase();
  const labelKey = ((label || '') as string).toLowerCase();

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
  const styles = getStyles();

  const groupedConfigurations = useMemo(() => {
    if (!groupTheModelsByProvider || !configurations?.length) return null;
    const groups: Record<string, Record<string, unknown>[]> = {};
    for (const config of configurations) {
      const c = config as Record<string, unknown>;
      const groupLabel = getGroupLabel(c.name as string | undefined, c.type as string | undefined, c.label as string | undefined);
      if (!groups[groupLabel]) groups[groupLabel] = [];
      groups[groupLabel].push(config);
    }
    for (const groupLabel of Object.keys(groups)) {
      const gc = groups[groupLabel];
      if (gc) gc.sort(sortByName);
    }
    return groups;
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
    <Box sx={styles.container}>
      <Typography variant="headingSmall" sx={styles.title}>{title}</Typography>

      {hasDefaultSetting && (
        <Box sx={styles.defaultSettingsContainer}>
          <SingleSelect
            label={typeof defaultSettingLabel === 'string' ? defaultSettingLabel : ''}
            value={defaultSettingValue}
            onChange={onChangeDefaultSetting || (() => {})}
            options={defaultSettingOptions}
            disabled={false}
          />

          {additionalDefaultSettings
            .filter((s): s is NonNullable<typeof s> => Boolean(s))
            .map((setting) => (
              <SingleSelect
                key={setting.key ?? String(setting.label ?? 'additional')}
                label={typeof setting.label === 'string' ? setting.label : ''}
                value={setting.value ?? ''}
                onChange={setting.onChange ?? (() => {})}
                options={setting.options ?? []}
                disabled={false}
              />
            ))}
        </Box>
      )}

      {groupTheModelsByProvider && groupedConfigurations ? (
        GROUP_ORDER.map((groupLabel) => {
          const groupConfigs = groupedConfigurations[groupLabel] ?? [];
          if (groupConfigs.length === 0) return null;
          return (
            <Box key={groupLabel} sx={styles.groupContainer}>
              <Typography variant="subtitle" color="text.primary">{groupLabel}</Typography>
              <Box sx={styles.configurationsContainer}>
                {groupConfigs.map((configuration, index) => {
                  const cfg = configuration as Record<string, unknown>;
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
            </Box>
          );
        })
      ) : (
        <Box sx={styles.configurationsContainer}>
          {sortedConfigurations.map((configuration, index) => {
            const cfg = configuration as Record<string, unknown>;
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
      )}
    </Box>
  );
});

function getStyles() {
  return {
    container: {
      padding: '1rem 1.5rem',
      gap: '0.5rem',
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
    },
    title: {
      color: '#9ca3af',
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
      borderBottom: '1px solid #292e42',
    },
  };
}
