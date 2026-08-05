// @ts-nocheck
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
import { usePermissionList } from '@/shared/api/generated/auth/auth';
import type { Permission } from '@/shared/api/generated/model';
import { PERMISSIONS } from '@/shared/lib/permissions';
import { useConfigurationNavigation } from '@/features/settings/lib/ai-configuration/useConfigurationNavigation';

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

interface ConfigurationSectionProps {
  title: string;
  configurations: readonly Record<string, unknown>[];
  /** Currently-selected project id — gates edit permission
   * (`PERMISSIONS.configuration.update`) and drives click-to-edit
   * navigation, same as the old app's `useSelectedProjectId()` read. */
  projectId: string;
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
 * Local per-user edit-permission check — mirrors the old app's
 * `useCheckPermission().checkPermission(PERMISSIONS.configuration.update)`
 * (`ConfigurationSection.jsx:64-65`), reimplemented against this app's
 * `usePermissionList(projectId, ...)` query the same way
 * `features/pipelines/lib/useHasPermission.ts` / `features/agents/lib/
 * useHasPermission.ts` / `features/chat-conversation-list/lib/
 * useHasPermission.ts` already do for their own features. Kept local
 * (not imported from a sibling feature) — `no-sideways-features` forbids
 * `features/settings` reaching into another feature's internals.
 */
function useCanEditConfiguration(projectId: string): boolean {
  const query = usePermissionList(projectId, { query: { enabled: !!projectId } });

  const permissions = useMemo(() => {
    const list = query.data?.data as Permission[] | undefined;
    if (!list) return new Set<string>();
    return new Set(list.filter((entry) => entry.enabled).map((entry) => entry.name));
  }, [query.data]);

  return permissions.has(PERMISSIONS.configuration.update);
}

/**
 * Renders ConfigurationCards for the given array of configurations.
 * Extracted to keep ConfigurationSection below the complexity budget.
 */
function ConfigCards({
  configurations,
  projectId,
  canEdit,
  defaultSettingValue,
  styles,
}: {
  configurations: readonly Record<string, unknown>[];
  projectId: string;
  canEdit: boolean;
  defaultSettingValue: string;
  styles: ReturnType<typeof getStyles>;
}) {
  // Old app: `ConfigurationCard.jsx`'s `handleCardClick` calls
  // `navigateToConfiguration(configuration.id, locationState)` on click,
  // routing into the configuration's edit view. Wired here (not passed
  // down as a prop) since the hook must be called from a component body.
  const { navigateToConfiguration } = useConfigurationNavigation();

  return (
    <Box sx={styles.configurationsContainer}>
      {configurations.map((configuration, index) => {
        const cfg = configuration;
        const d = cfg.data as Record<string, unknown> | undefined;
        return (
          <ConfigurationCard
            key={`${(cfg.id as string) || (cfg.name as string)}-${index}`}
            configuration={configuration}
            projectId={projectId}
            canEdit={canEdit}
            isDefault={defaultSettingValue === `${(d?.name as string) ?? ''}<<>>${(cfg.project_id as string) ?? ''}`}
            onClick={navigateToConfiguration}
          />
        );
      })}
    </Box>
  );
}

export default memo(function ConfigurationSection({
  title,
  configurations,
  projectId,
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
  const canEdit = useCanEditConfiguration(projectId);

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
      projectId={projectId}
      canEdit={canEdit}
      defaultSetting={{
        has: hasDefaultSetting,
        value: defaultSettingValue,
        label: defaultSettingLabel,
        options: defaultSettingOptions,
        onChange: onChangeDefaultSetting,
        additional: additionalDefaultSettings,
      }}
      grouping={{
        byProvider: groupTheModelsByProvider,
        grouped: groupedConfigurations,
        sorted: sortedConfigurations,
      }}
    />
  );
});

interface ConfigurationSectionDefaultSetting {
  has?: boolean;
  value: string;
  label?: React.ReactNode;
  options?: Array<{ value: string; label: string }>;
  onChange?: (value: string) => void;
  additional?: AdditionalDefaultSetting[];
}

interface ConfigurationSectionGrouping {
  byProvider?: boolean;
  grouped?: Record<string, Record<string, unknown>[]> | null;
  sorted?: readonly Record<string, unknown>[];
}

function ConfigurationSectionBody({
  title, styles, projectId, canEdit, defaultSetting, grouping,
}: {
  title: string;
  styles: ReturnType<typeof getStyles>;
  projectId: string;
  canEdit: boolean;
  defaultSetting: ConfigurationSectionDefaultSetting;
  grouping: ConfigurationSectionGrouping;
}) {
  return (
    <Box sx={styles.container}>
      <Typography variant="headingSmall" sx={styles.title}>{title}</Typography>

      {defaultSetting.has && (
        <DefaultSettingsSelects
          canEdit={canEdit}
          defaultSettingValue={defaultSetting.value}
          defaultSettingLabel={defaultSetting.label}
          defaultSettingOptions={defaultSetting.options}
          onChangeDefaultSetting={defaultSetting.onChange}
          additionalDefaultSettings={defaultSetting.additional}
        />
      )}

      {grouping.byProvider && grouping.grouped ? (
        GROUP_ORDER.map((groupLabel) => {
          const groupConfigs = grouping.grouped?.[groupLabel] ?? [];
          if (groupConfigs.length === 0) return null;
          return (
            <Box key={groupLabel} sx={styles.groupContainer}>
              <Typography variant="subtitle" color="text.primary">{groupLabel}</Typography>
              <ConfigCards
                configurations={groupConfigs}
                projectId={projectId}
                canEdit={canEdit}
                defaultSettingValue={defaultSetting.value}
                styles={styles}
              />
            </Box>
          );
        })
      ) : (
        <ConfigCards
          configurations={grouping.sorted ?? []}
          projectId={projectId}
          canEdit={canEdit}
          defaultSettingValue={defaultSetting.value}
          styles={styles}
        />
      )}
    </Box>
  );
}

function DefaultSettingsSelects({
  canEdit, defaultSettingValue, defaultSettingLabel, defaultSettingOptions,
  onChangeDefaultSetting, additionalDefaultSettings,
}: {
  canEdit: boolean;
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
        disabled={!canEdit}
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
            disabled={!canEdit}
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
