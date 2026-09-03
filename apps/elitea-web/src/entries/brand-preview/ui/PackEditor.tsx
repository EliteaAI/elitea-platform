/**
 * A small editor for the scalar fields a designer iterates on most
 * (ADR-0024 WP9). Every change rebuilds the pack object, and the preview
 * derives from it live. The admin console is the real editor; this one
 * exists so a package can be tuned with no Elitea running.
 */
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { BrandPack } from '@/shared/brand';
import { formatHex, parseColor } from '@/shared/brand/color';
import { t } from '@/shared/i18n';

import { applyHue } from '../lib/editPack';
import type { PreviewActions } from '../model/usePreviewState';

interface PackEditorProps {
  readonly pack: BrandPack;
  /** The pack as loaded, before edits — the hue edit derives against it (`editPack.ts`). */
  readonly basePack: BrandPack;
  readonly updatePack: PreviewActions['updatePack'];
}

/** `<input type="color">` takes six hex digits only; any other spelling is shown through the parser. */
function pickerValue(hue: string): string | undefined {
  const parsed = parseColor(hue);
  return parsed === null ? undefined : formatHex({ ...parsed, a: 1 }).slice(0, 7);
}

function HueField({ pack, basePack, updatePack }: PackEditorProps) {
  const setHue = (hue: string): void => updatePack((current) => applyHue(current, basePack, hue));
  const picker = pickerValue(pack.brand.hue);
  const label = t('entries.brandPreview.editor.hue', 'Brand hue');
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
      {picker === undefined ? null : (
        <Box
          component="input"
          type="color"
          aria-label={`${label} ${t('entries.brandPreview.editor.picker', 'picker')}`}
          data-testid="brand-preview-hue-picker"
          value={picker}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setHue(event.target.value)}
          sx={(theme) => ({
            width: '2.5rem',
            height: '2.5rem',
            padding: 0,
            border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
            borderRadius: theme.vars.shape.radiusSm,
            background: 'transparent',
            cursor: 'pointer',
            flex: '0 0 auto',
          })}
        />
      )}
      <TextField
        size="small"
        label={label}
        value={pack.brand.hue}
        onChange={(event) => setHue(event.target.value)}
        slotProps={{ htmlInput: { 'data-testid': 'brand-preview-hue', spellCheck: false } }}
        fullWidth
      />
    </Box>
  );
}

export function PackEditor({ pack, basePack, updatePack }: PackEditorProps) {
  return (
    <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="brand-preview-editor">
      <Typography variant="headingSmall" component="h2">
        {t('entries.brandPreview.editor.title', 'Edit')}
      </Typography>
      <TextField
        size="small"
        label={t('entries.brandPreview.editor.productName', 'Product name')}
        value={pack.product.name}
        onChange={(event) =>
          updatePack((current) => ({ ...current, product: { ...current.product, name: event.target.value } }))
        }
        slotProps={{ htmlInput: { 'data-testid': 'brand-preview-product-name' } }}
      />
      <TextField
        size="small"
        label={t('entries.brandPreview.editor.shortName', 'Short name')}
        value={pack.product.shortName}
        onChange={(event) =>
          updatePack((current) => ({ ...current, product: { ...current.product, shortName: event.target.value } }))
        }
      />
      <HueField pack={pack} basePack={basePack} updatePack={updatePack} />
      <TextField
        size="small"
        label={t('entries.brandPreview.editor.fontFamily', 'Font family')}
        value={pack.typography.fontFamily}
        onChange={(event) =>
          updatePack((current) => ({
            ...current,
            typography: { ...current.typography, fontFamily: event.target.value },
          }))
        }
        slotProps={{ htmlInput: { 'data-testid': 'brand-preview-font-family', spellCheck: false } }}
      />
      <TextField
        size="small"
        type="number"
        label={t('entries.brandPreview.editor.radius', 'Radius (medium, px)')}
        value={pack.shape.radiusMd}
        onChange={(event) => {
          const radiusMd = Number(event.target.value);
          if (!Number.isFinite(radiusMd) || radiusMd < 0) return;
          updatePack((current) => ({ ...current, shape: { ...current.shape, radiusMd } }));
        }}
        slotProps={{ htmlInput: { min: 0, step: 1, 'data-testid': 'brand-preview-radius' } }}
      />
      <TextField
        size="small"
        select
        label={t('entries.brandPreview.editor.density', 'Density')}
        value={pack.shape.density}
        onChange={(event) => {
          const density = event.target.value === 'compact' ? 'compact' : 'comfortable';
          updatePack((current) => ({ ...current, shape: { ...current.shape, density } }));
        }}
        slotProps={{ htmlInput: { 'data-testid': 'brand-preview-density' } }}
      >
        <MenuItem value="comfortable">{t('entries.brandPreview.editor.densityComfortable', 'Comfortable')}</MenuItem>
        <MenuItem value="compact">{t('entries.brandPreview.editor.densityCompact', 'Compact')}</MenuItem>
      </TextField>
    </Box>
  );
}
