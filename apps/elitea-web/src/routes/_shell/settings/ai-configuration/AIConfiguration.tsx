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

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';

import { t } from '@/shared/ui/lib/t';

import ConfigurationsPanel from './ConfigurationsPanel';
import OpenAITemplate from './OpenAITemplate';
import { useConfigurationsBySection } from './useConfigurationsBySection';

export const AIConfiguration = memo(function AIConfiguration() {
  const [activeTab, setActiveTab] = useState(0);
  const { data: configurationsBySection, isLoading } = useConfigurationsBySection();

  const tabs = [
    { label: t('ai-configuration.tabs.configurations', 'Configurations') },
    { label: t('ai-configuration.tabs.openaiTemplate', 'OpenAI Template') },
  ];

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const styles = getStyles();

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

      {/* Tab content */}
      <Box sx={styles.tabPanel}>
        {activeTab === 0 && configurationsBySection ? (
          <ConfigurationsPanel
            configurationsBySection={configurationsBySection as unknown as Record<string, Record<string, unknown>[]>}
            isLoading={isLoading}
          />
        ) : activeTab === 0 && !configurationsBySection && isLoading ? (
          <Box sx={styles.loadingCenter}>
            {t('ai-configuration.section.loading', 'Loading...')}
          </Box>
        ) : null}

        {activeTab === 1 && <OpenAITemplate />}
      </Box>
    </Box>
  );
});

function getStyles() {
  return {
    pageWrapper: {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    },
    tabBar: {
      backgroundColor: '#1a1b26',
      borderBottom: '1px solid #292e42',
      flexShrink: 0,
      '& .MuiTabs-flexContainer': {
        justifyContent: 'stretch',
      },
    },
    tab: {
      textTransform: 'none',
      fontWeight: 500,
      fontSize: '0.875rem',
      color: '#9ca3af',
      minHeight: '2.5rem',
      '&.Mui-selected': {
        color: '#e5e7eb',
        fontWeight: 600,
        borderBottom: '2px solid #3b82f6',
      },
    },
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
      alignItems: 'center',
      justifyContent: 'center',
      color: '#9ca3af',
    },
  };
}
