import { useCallback, useState } from 'react';

import Box from '@mui/material/Box';

import { useApplicationCatalog } from '../../api/useApplicationCatalog';
import { useModerationRequests } from '../../api/useModerationRequests';
import type { CatalogApplication } from '../../model/types';

import { ApplicationCatalogCard } from './ApplicationCatalogCard';
import { RequestAccessModal } from './RequestAccessModal';

const wrapperSx = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '1.5rem',
  px: '1.5rem',
  pt: '1rem',
  pb: '2rem',
};

const gridSx = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 20rem), 36rem))',
  gap: '1rem',
  alignItems: 'stretch',
};

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/apps/ui/catalog/ApplicationCatalog.jsx`
 * — the "App Catalog" tab of `pages/apps/Apps.tsx`. Fully self-contained:
 * unlike the "Applications" tab (`ToolkitsList`, `features/toolkits` — not
 * landed, see `pages/apps/Apps.tsx`'s own doc comment), this tab has no
 * cross-domain dependency.
 *
 * `RouteDefinitions.CreateAppType` navigation (the baseline's
 * `handleConfigure`, `navigate(RouteDefinitions.CreateAppType.replace(...))`)
 * is dropped in favour of TanStack Router's typed `useNavigate` against
 * `/apps/create/$appType` (ROUTE-038, already mounted by unit R1).
 */
export function ApplicationCatalog({ onConfigure }: { onConfigure: (appType: string) => void }) {
  const { applications, isLoading } = useApplicationCatalog();
  const { getRequestStatus, submitRequest, isSubmitting, isFetching } = useModerationRequests();

  const [requestModalApp, setRequestModalApp] = useState<CatalogApplication | null>(null);

  const handleOpenRequestModal = useCallback((application: CatalogApplication) => {
    setRequestModalApp(application);
  }, []);

  const handleCloseRequestModal = useCallback(() => {
    setRequestModalApp(null);
  }, []);

  const handleSubmitRequest = useCallback(
    (application: CatalogApplication, reason: string) => {
      void submitRequest(application.type, reason, application.typeLabel);
      setRequestModalApp(null);
    },
    [submitRequest],
  );

  const handleConfigure = useCallback(
    (application: CatalogApplication) => {
      onConfigure(application.type);
    },
    [onConfigure],
  );

  return (
    <Box sx={wrapperSx}>
      <Box sx={gridSx}>
        {applications.map((application) => (
          <ApplicationCatalogCard
            key={application.type}
            application={application}
            requestStatus={getRequestStatus(application.type)}
            isLoading={isLoading}
            isFetchingStatus={isFetching}
            onConfigure={handleConfigure}
            onRequestAccess={handleOpenRequestModal}
          />
        ))}
      </Box>

      <RequestAccessModal
        open={requestModalApp !== null}
        application={requestModalApp}
        isSubmitting={isSubmitting}
        onClose={handleCloseRequestModal}
        onSubmit={handleSubmitRequest}
      />
    </Box>
  );
}
