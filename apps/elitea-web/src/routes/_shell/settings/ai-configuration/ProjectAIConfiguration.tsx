/**
 * ProjectAIConfiguration — displays server URL, OpenAI BaseURL, Project ID info.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/Configuration/ProjectAIConfiguration.jsx`.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';

import { t } from '@/shared/ui/lib/t';

import FieldWithCopy from './FieldWithCopy';

interface ProjectAIConfigurationProps {
  userApiUrl?: string;
  projectId?: string;
  modelProjectId?: string;
}

export default memo(function ProjectAIConfiguration({ userApiUrl, projectId, modelProjectId }: ProjectAIConfigurationProps) {
  const styles = projectAIConfigurationStyles();

  const baseUrl = userApiUrl ? `${userApiUrl.replace('/api/v2', '')}/llm/v1` : t('ai-configuration.projectConfig.notConfigured', 'Not configured');

  return (
    <Box sx={styles.projectConfigSection}>
      <Box sx={styles.fieldsGrid}>
        <FieldWithCopy label={`${t('ai-configuration.projectConfig.openaiBase', 'OpenAI-BaseURL:')} `} value={baseUrl} />
        {modelProjectId ? (
          <FieldWithCopy label={`${t('ai-configuration.projectConfig.openaiProject', 'OpenAI-Project:')} `} value={modelProjectId} />
        ) : (
          <Box />
        )}
      </Box>
      <Box sx={styles.fieldsGrid}>
        <FieldWithCopy label={`${t('ai-configuration.projectConfig.serverUrl', 'Server URL:')} `} value={userApiUrl || t('ai-configuration.projectConfig.notConfigured', 'Not configured')} />
        <FieldWithCopy label={`${t('ai-configuration.projectConfig.projectId', 'Project ID:')} `} value={projectId || t('ai-configuration.projectConfig.notConfigured', 'Not configured')} />
      </Box>
    </Box>
  );
});

function projectAIConfigurationStyles() {
  return {
    projectConfigSection: {
      flexShrink: 0,
      padding: '1rem 1.5rem',
      backgroundColor: '#1a1b26',
      borderBottom: '1px solid #292e42',
      gap: '0.25rem',
      width: '100%',
    },
    fieldsGrid: {
      display: 'grid',
      gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
      gap: '1rem',
    },
  };
}
