/** ROUTE-049 `/artifacts/create-bucket` -> `CreateBucket` (spec §8.1). */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import { useState } from 'react';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { t } from '@/shared/i18n';

function CreateBucketPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');

  const handleCreate = () => {
    void navigate({ to: '/artifacts' });
  };

  return (
    <Box component="section" sx={{ padding: 2, maxWidth: 480 }}>
      <h1>{t('routes.artifacts.create-bucket.heading', 'Create Bucket')}</h1>
      <Box component="form" onSubmit={(e) => { e.preventDefault(); handleCreate(); }} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label={t('artifacts.bucketName', 'Bucket name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': t('artifacts.bucketName', 'Bucket name') } }}
          required
        />
        <Button type="submit" variant="contained" disabled={!name.trim()}>
          {t('artifacts.create', 'Create')}
        </Button>
      </Box>
    </Box>
  );
}

export const Route = createFileRoute('/_shell/artifacts/create-bucket')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CreateBucketPage,
});
