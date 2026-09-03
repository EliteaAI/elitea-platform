/**
 * Export (ADR-0024 WP9): the edited pack as `brand-pack.json`. A download
 * from a `file://` page or an artifact viewer can be blocked, so the same
 * text is also shown read-only with a copy button.
 */
import { useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { BrandPack } from '@/shared/brand';
import { t } from '@/shared/i18n';

import { BRAND_PACK_FILE_NAME, serialiseBrandPack } from '../lib/exportPack';

/** Object URLs are revoked after the click has had a moment to start the save. */
const REVOKE_DELAY_MS = 1_000;

function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export function ExportPanel({ pack }: { readonly pack: BrandPack }) {
  const [status, setStatus] = useState<string>('');
  const json = serialiseBrandPack(pack);

  const copy = (): void => {
    navigator.clipboard
      .writeText(json)
      .then(() => setStatus(t('entries.brandPreview.export.copied', 'Copied to the clipboard.')))
      .catch(() =>
        setStatus(t('entries.brandPreview.export.copyFailed', 'Copy was refused here — select the text and copy it.')),
      );
  };

  return (
    <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="brand-preview-export">
      <Typography variant="headingSmall" component="h2">
        {t('entries.brandPreview.export.title', 'Export')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="elitea" color="primary" size="small" onClick={() => downloadText(BRAND_PACK_FILE_NAME, json)}>
          {t('entries.brandPreview.export.download', 'Download brand-pack.json')}
        </Button>
        <Button variant="secondary" size="small" onClick={copy}>
          {t('entries.brandPreview.export.copy', 'Copy')}
        </Button>
      </Box>
      {status === '' ? null : (
        <Typography variant="bodySmall" color="text.secondary" aria-live="polite">
          {status}
        </Typography>
      )}
      <TextField
        multiline
        minRows={8}
        maxRows={20}
        value={json}
        label={t('entries.brandPreview.export.json', 'brand-pack.json')}
        slotProps={{
          input: { readOnly: true, sx: (theme) => ({ fontFamily: theme.typography.fontFamilyMono }) },
          htmlInput: { 'data-testid': 'brand-preview-export-json', spellCheck: false },
        }}
      />
    </Box>
  );
}
