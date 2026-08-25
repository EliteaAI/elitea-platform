// @ts-nocheck
/**
 * AIConfiguration page — composes project config, configuration sections,
 * model capabilities, and OpenAI Template into the tab content.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/pages/settings/AIConfiguration.jsx`.
 *
 * The old app used a two-tab bar (AI Configuration / OpenAI Template).
 * In the new app, the outer `settings-layout.tsx` provides the page chrome;
 * this component renders its own sub-tabs to match the old layout.
 */
import { memo, useState } from 'react';
import { useTheme, type Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import { EliteaApiError } from '@/shared/api/generated/mutator';
import { getConfig } from '@/shared/config';
import { t } from '@/shared/i18n';

import { aiConfigurationFeature } from '@/features/settings';

const {
  ConfigurationsPanel,
  OpenAITemplate,
  ProjectAIConfiguration,
  useConfigurationsBySection,
} = aiConfigurationFeature;

/**
 * `userApiUrl` — the baseline reads `state.user.api_url` from Redux
 * (`ModelConfiguration.jsx:27,243`). This app has no user slice; the same
 * value is `shared/config`'s `vite_server_url` (`VITE_SERVER_URL`), which is
 * what the baseline's `api_url` is populated from. `ProjectAIConfiguration`
 * itself renders the "Not configured" fallback when this is empty, so a
 * failed/absent config resolves to the baseline's own empty-state string
 * rather than throwing.
 */
function useUserApiUrl(): string {
  const configResult = getConfig();
  return configResult.status === 'ok' ? configResult.config.vite_server_url : '';
}

/** `EliteaApiError`'s 403 case — the same test `pages/credentials/CredentialsList.tsx` applies. */
function isForbiddenError(error: unknown): boolean {
  if (!(error instanceof EliteaApiError)) return false;
  const { failure } = error;
  return (failure.kind === 'http' || failure.kind === 'auth') && failure.status === 403;
}

/**
 * A FAILED SECTION LIST IS NOT AN EMPTY ONE. Before this branch existed, a
 * 403 from `GET /configurations/configurations/{projectId}` reached the page
 * as seven empty sections. The screen told the user the project had no LLM
 * configuration when the request never returned a list at all.
 */
function ConfigurationsError({ error, onRetry, styles }: {
  error: unknown;
  onRetry: () => void;
  styles: ReturnType<typeof getStyles>;
}) {
  return (
    <Box sx={styles.loadingCenter}>
      <Typography variant="bodyMedium" role="alert">
        {isForbiddenError(error)
          ? t('ai-configuration.section.forbidden', 'You do not have permission to read the configurations of this project.')
          : t('ai-configuration.section.loadFailed', 'The configurations could not be loaded.')}
      </Typography>
      <Button onClick={onRetry} variant="text">
        {t('ai-configuration.section.retry', 'Try again')}
      </Button>
    </Box>
  );
}

export interface AIConfigurationProps {
  /** Currently-selected project id — threaded down from the route. */
  projectId: string;
}

export const AIConfiguration = memo(function AIConfiguration({ projectId }: AIConfigurationProps) {
  const [activeTab, setActiveTab] = useState(0);
  const { data: configurationsBySection, isLoading, error, refetch } = useConfigurationsBySection(projectId);
  const theme = useTheme();
  const styles = getStyles(theme);

  const userApiUrl = useUserApiUrl();
  /*
   * The model-owning project id used to be computed here and passed to
   * ProjectAIConfiguration, which advertised it as `OpenAI-Project`. It is
   * gone: that panel now shows the billing project only. A reader could not
   * tell the two ids apart, and the generated samples sent the model's project
   * as the project to bill (ADR-0018, spec-llm-project-scope §9).
   */

  const tabs = [
    { label: t('ai-configuration.tabs.configurations', 'Configurations') },
    { label: t('ai-configuration.tabs.openaiTemplate', 'OpenAI Template') },
  ];

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  return (
    <Box sx={styles.pageWrapper}>
      {/* Sub-tabs — mirrors the old app's StickyTabs */}
      <Tabs
        value={activeTab}
        onChange={handleTabChange}
        variant="fullWidth"
        sx={styles.tabBar}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.label}
            label={tab.label}
            sx={styles.tab}
          />
        ))}
      </Tabs>

      {/*
        Baseline `ModelConfiguration.jsx:243` renders `<ProjectConfiguration>`
        immediately above `<ConfigurationsPanel>`, inside the configurations
        tab only (the OpenAI-Template tab has its own chrome). Same placement
        here.
      */}
      {activeTab === 0 && (
        <ProjectAIConfiguration
          userApiUrl={userApiUrl}
          projectId={projectId}
        />
      )}

      {/* Tab content */}
      <Box sx={styles.tabPanel}>
        {activeTab === 0 && error ? (
          <ConfigurationsError error={error} onRetry={refetch} styles={styles} />
        ) : activeTab === 0 && configurationsBySection ? (
          <ConfigurationsPanel
            configurationsBySection={configurationsBySection as unknown as Record<string, Record<string, unknown>[]>}
            projectId={projectId}
            isLoading={isLoading}
          />
        ) : activeTab === 0 && !configurationsBySection && isLoading ? (
          <Box sx={styles.loadingCenter}>
            {t('ai-configuration.section.loading', 'Loading...')}
          </Box>
        ) : null}

        {activeTab === 1 && <OpenAITemplate projectId={projectId} />}
      </Box>
    </Box>
  );
});

function getStyles(theme: ReturnType<typeof useTheme>) {
  const t = theme as Theme;
  return {
    pageWrapper: {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    },
    tabBar: {
      backgroundColor: t.vars.palette.background.eliteaDefault,
      borderBottom: `1px solid ${t.vars.palette.border.lines}`,
      flexShrink: 0,
    },
    tab: ({ typography }: { typography: Record<string, unknown> & { headingSmall: { fontSize: number } } }) => ({
      textTransform: 'none',
      fontWeight: 500,
      fontSize: typography.headingSmall.fontSize,
      color: t.vars.palette.text.secondary,
      minHeight: '2.5rem',
      flexGrow: 1,
      '&.Mui-selected': {
        color: t.vars.palette.text.default,
        fontWeight: 600,
        borderBottom: `2px solid ${t.vars.palette.primary.main}`,
      },
    }),
    tabPanel: {
      flex: 1,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    },
    loadingCenter: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      alignItems: 'center',
      justifyContent: 'center',
      color: t.vars.palette.text.secondary,
    },
  };
}
