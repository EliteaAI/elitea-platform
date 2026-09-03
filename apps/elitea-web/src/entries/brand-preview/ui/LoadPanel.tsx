/**
 * Load controls (ADR-0024 WP9). The page opens from `file://`, where a
 * relative fetch is refused by every browser, so files come in through two
 * `<input type="file">` controls and a drop zone. Nothing is written
 * anywhere: a pack becomes state, an asset becomes an object URL.
 */
import type { DragEvent } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { ASSET_FILE_ACCEPT, describeTarget } from '../lib/assets';
import type { PreviewActions, PreviewState } from '../model/usePreviewState';

interface LoadPanelProps {
  readonly state: PreviewState;
  readonly actions: PreviewActions;
}

function PackStatus({ state }: { readonly state: PreviewState }) {
  return (
    <Typography variant="bodySmall" data-testid="brand-preview-pack-status">
      {`${t('entries.brandPreview.load.activePack', 'Active pack')}: ${state.pack.id} v${state.pack.version} — ${state.sourceLabel}`}
    </Typography>
  );
}

function IssueList({ issues }: { readonly issues: readonly string[] }) {
  if (issues.length === 0) return null;
  return (
    <Alert severity="error" data-testid="brand-preview-issues">
      <Typography variant="labelSmall" component="p">
        {t('entries.brandPreview.load.refused', 'The pack failed validation:')}
      </Typography>
      <Box component="ul" sx={{ margin: 0, paddingLeft: 2.5 }}>
        {issues.map((issue) => (
          <Typography component="li" variant="bodySmall" key={issue}>
            {issue}
          </Typography>
        ))}
      </Box>
    </Alert>
  );
}

function LoadedAssetChips({ state }: { readonly state: PreviewState }) {
  const loaded = [...state.assets.values()];
  if (loaded.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }} data-testid="brand-preview-loaded-assets">
      {loaded.map((asset) => (
        <Chip key={asset.objectUrl} size="small" label={`${asset.fileName} → ${describeTarget(asset.target)}`} />
      ))}
    </Box>
  );
}

function Notices({ notices }: { readonly notices: readonly string[] }) {
  if (notices.length === 0) return null;
  return (
    <Box component="ul" aria-live="polite" sx={{ margin: 0, paddingLeft: 2.5 }} data-testid="brand-preview-notices">
      {notices.map((notice, index) => (
        <Typography component="li" variant="bodySmall" color="text.secondary" key={`${index}-${notice}`}>
          {notice}
        </Typography>
      ))}
    </Box>
  );
}

export function LoadPanel({ state, actions }: LoadPanelProps) {
  const onDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    void actions.dropFiles(event.dataTransfer.files);
  };
  return (
    <Box
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        padding: 2,
        borderRadius: theme.vars.shape.radiusMd,
        border: `0.0625rem dashed ${theme.vars.palette.border.lines}`,
      })}
      data-testid="brand-preview-dropzone"
    >
      <Typography variant="headingSmall" component="h2">
        {t('entries.brandPreview.load.title', 'Load')}
      </Typography>
      <Typography variant="bodySmall" color="text.secondary">
        {t('entries.brandPreview.load.hint', 'Drop brand-pack.json and assets here, or pick them below. Nothing leaves this page.')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="elitea" color="primary" size="small" component="label">
          {t('entries.brandPreview.load.pack', 'Load brand-pack.json')}
          <Box
            component="input"
            type="file"
            accept=".json,application/json"
            data-testid="brand-preview-pack-input"
            sx={{ display: 'none' }}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void actions.loadPackFile(file);
              event.target.value = '';
            }}
          />
        </Button>
        <Button variant="secondary" size="small" component="label">
          {t('entries.brandPreview.load.assets', 'Add assets')}
          <Box
            component="input"
            type="file"
            multiple
            accept={ASSET_FILE_ACCEPT}
            data-testid="brand-preview-asset-input"
            sx={{ display: 'none' }}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              actions.addAssetFiles(event.target.files ?? []);
              event.target.value = '';
            }}
          />
        </Button>
      </Box>
      <PackStatus state={state} />
      <IssueList issues={state.issues} />
      <LoadedAssetChips state={state} />
      <Notices notices={state.notices} />
    </Box>
  );
}
