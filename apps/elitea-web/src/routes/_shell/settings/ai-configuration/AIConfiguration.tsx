/**
 * AIConfiguration page — composes project config, configuration section,
 * and model capabilities into the tab content for model configuration.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/pages/settings/AIConfiguration.jsx`.
 */
import { memo } from 'react';

import Box from '@mui/material/Box';

import ProjectAIConfiguration from './ProjectAIConfiguration';
import ConfigurationSection from './ConfigurationSection';
import { useGetConfigurationsListQuery } from '@/shared/api/configurationsApi';
import { useSelectedProjectStore } from '@/widgets/app-shell';

const SECTION_MODEL = 'model';

export const AIConfiguration = memo(function AIConfiguration() {
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');

  const { data, isLoading } = useGetConfigurationsListQuery(
    {
      projectId,
      section: SECTION_MODEL,
      includeShared: true,
      pageSize: 200,
    },
    { enabled: !!projectId },
  );

  const items = data?.items;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'auto',
      }}
    >
      <ProjectAIConfiguration />
      <ConfigurationSection
        title="Model Configuration"
        configurations={items as unknown as readonly Record<string, unknown>[]}
        isLoading={isLoading}
        groupTheModelsByProvider
      />
    </Box>
  );
});
