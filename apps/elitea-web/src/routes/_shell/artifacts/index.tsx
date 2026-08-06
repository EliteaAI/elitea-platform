/**
 * ROUTE-048 `/artifacts` -> `Artifacts` (spec §8.1: "requires
 * `artifacts.view`" — the P8 fix, task item 4; PERM-003
 * `configuration.artifacts.artifacts.view`). Query params PARAM-024..027
 * (`bucket`, `file`, `folder`, `shared_bucket` — spec QP-009). `index.tsx`
 * keeps `/artifacts/create-bucket` an independent sibling (same
 * non-nesting property as `agents/index.tsx`/`apps/index.tsx`) instead of
 * nesting it under this route, matching old app's flat sibling routes.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import Button from '@mui/material/Button';

import { requireArtifactsPermission } from '../../-guards/requirePermission';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { pickParams } from '../../-search/params';
import { t } from '@/shared/i18n';

function ArtifactsPage() {
  const navigate = useNavigate();
  const handleCreate = useCallback(() => {
    void navigate({ to: '/artifacts/create-bucket' });
  }, [navigate]);

  return (
    <section>
      <h1>{t('routes.artifacts.heading', 'Artifacts')}</h1>
      <Button
        onClick={handleCreate}
        variant="contained"
        data-testid="create-bucket-button"
      >
        {t('artifacts.createBucket', 'Create bucket')}
      </Button>
    </section>
  );
}

export const Route = createFileRoute('/_shell/artifacts/')({
  validateSearch: pickParams('bucket', 'file', 'folder', 'shared_bucket'),
  beforeLoad: requireArtifactsPermission,
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: ArtifactsPage,
});
