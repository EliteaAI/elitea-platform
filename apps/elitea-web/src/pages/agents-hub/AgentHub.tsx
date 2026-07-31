/**
 * Agents Hub page — main landing for discovering agents.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/pages/agent-hub/AgentHub.jsx`.
 *
 * Deviations:
 *  - No tour integration (A13 §6.6: tour targets dropped for agents-hub).
 *  - No Redux — uses zustand-based `useAgentHubData`.
 *  - No AgentHubContext — state updates go directly through hooks.
 *  - Route wiring is out of scope.
 */
import { memo, useCallback, useState } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { useAgentHubData } from './useAgentHubData';
import { AgentCategorySection, AgentModal } from './ui';
import type { ApplicationData } from './types';

export interface AgentHubProps {
  // Intentionally empty — route props are handled at the route layer.
}

const AgentHub = memo(() => {
  const [selectedTagNames] = useState<string[]>([]);
  const [selectedApplication, setSelectedApplication] = useState<ApplicationData | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    allCategories,
    applicationsByTag,
    totalCountsByTag,
    loadingTags,
    refreshingTags,
    onRefresh,
  } = useAgentHubData(selectedTagNames);

  const handleApplicationSelect = useCallback((app: ApplicationData) => {
    setSelectedApplication(app);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedApplication(null);
  }, []);

  const handleLoadMore = useCallback(
    (_category: string) => {
      // All data is fetched upfront — no-op for pagination.
    },
    [],
  );

  const renderCategory = useCallback(
    (category: string, items: ApplicationData[]) => (
      <AgentCategorySection
        key={category}
        category={category}
        items={items}
        totalCount={totalCountsByTag[category] || 0}
        isLoading={refreshingTags.has(category)}
        isLoadingMore={loadingTags.has(category)}
        onSelectItem={handleApplicationSelect}
        onLoadMore={handleLoadMore}
        onRefresh={(cat: string) => { void onRefresh(cat); }}
      />
    ),
    [handleApplicationSelect, handleLoadMore, loadingTags, onRefresh, refreshingTags, totalCountsByTag],
  );

  const styles: Record<string, SxProps<Theme>> = {
    workspace: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    },
  };

  return (
    <Box sx={styles.workspace}>
      {allCategories
        .filter(cat => cat !== 'Other') // Skip empty "Other" category
        .map(category => {
          const items = applicationsByTag[category] || [];
          return items.length > 0 ? renderCategory(category, items) : null;
        })}
      {selectedApplication && (
        <AgentModal
          open={isModalOpen}
          onClose={handleCloseModal}
          agent={selectedApplication}
        />
      )}
    </Box>
  );
});

AgentHub.displayName = 'AgentHub';

export default AgentHub;
