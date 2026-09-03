/**
 * The previewer page (ADR-0024 WP9): load, edit and export on the left, the
 * two schemes side by side on the right.
 *
 * Two themes are on the page. The page's own chrome renders under the
 * compiled default pack, unscoped, so the tool looks the same whatever pack
 * is loaded. The preview theme is built from the ACTIVE pack under
 * `PREVIEW_THEME_SCOPE`, and only the two sample surfaces carry its
 * variables (see `SchemePreview.tsx`).
 *
 * A pack that the editor drives into an unbuildable state (a hue the
 * derivation cannot parse, say) keeps the last theme that built and reports
 * the error, rather than blanking the page.
 */
import { useMemo } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

import {
  FONT_FACE_STYLE_ATTRIBUTE,
  PREVIEW_THEME_SCOPE,
  buildEliteaTheme,
  type BrandPack,
  type EliteaTheme,
  type SchemeName,
} from '@/shared/brand';
import { t } from '@/shared/i18n';

import type { BootstrapResult } from '../lib/bootstrap';
import { previewFontStylesheet } from '../lib/fontSources';
import { usePreviewState } from '../model/usePreviewState';

import { ExportPanel } from './ExportPanel';
import { LoadPanel } from './LoadPanel';
import { PackEditor } from './PackEditor';
import { SchemePreview } from './SchemePreview';

const SCHEMES: readonly SchemeName[] = ['light', 'dark'];

/**
 * The class `PREVIEW_THEME_SCOPE.rootSelector` names. MUI declares a theme's
 * palette variables under the scheme selector, but its OTHER variables —
 * `--elp-spacing`, `--elp-shape-*`, typography — under the root selector
 * only. The container of both surfaces carries the class so those resolve;
 * each surface then selects its own palette with the scheme attribute, and
 * an element's own declarations beat the ones it inherits.
 */
const PREVIEW_ROOT_CLASS = PREVIEW_THEME_SCOPE.rootSelector.replace(/^\./, '');

interface BuiltTheme {
  readonly pack: BrandPack;
  readonly theme: EliteaTheme;
  readonly error: string | undefined;
}

/**
 * The theme for `pack`, or — when the edited pack does not build — the
 * theme of the pack the page STARTED from, plus the reason. The starting
 * pack always builds: an inline or loaded pack passed the trial build in
 * `validateBrandPack`, and the compiled default builds by construction.
 */
function buildOrFallBack(pack: BrandPack, fallback: BrandPack): BuiltTheme {
  try {
    return { pack, theme: buildEliteaTheme(pack, PREVIEW_THEME_SCOPE), error: undefined };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    return { pack: fallback, theme: buildEliteaTheme(fallback, PREVIEW_THEME_SCOPE), error };
  }
}

export function BrandPreviewApp({ bootstrap }: { readonly bootstrap: BootstrapResult }) {
  const [state, actions] = usePreviewState(bootstrap);
  const built = useMemo(() => buildOrFallBack(state.pack, bootstrap.pack), [state.pack, bootstrap.pack]);
  const fontCss = previewFontStylesheet(state.pack, state.assets);

  return (
    <Box
      component="main"
      sx={(theme) => ({
        minHeight: '100vh',
        padding: 3,
        backgroundColor: theme.vars.palette.background.default,
        color: theme.vars.palette.text.primary,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      })}
    >
      {fontCss === '' ? null : <style {...{ [FONT_FACE_STYLE_ATTRIBUTE]: '' }}>{fontCss}</style>}
      <Box component="header" sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="headingLarge" component="h1">
          {t('entries.brandPreview.title', 'Brand preview')}
        </Typography>
        <Chip size="small" label={state.sourceLabel} data-testid="brand-preview-source" />
        <Typography variant="bodySmall" color="text.secondary">
          {t('entries.brandPreview.subtitle', 'Offline. Open from disk, load a branding package, iterate, export.')}
        </Typography>
      </Box>
      {built.error === undefined ? null : (
        <Alert severity="error" data-testid="brand-preview-build-error">
          {`${t('entries.brandPreview.buildError', 'The edited pack cannot be built into a theme; showing the last one that could')}: ${built.error}`}
        </Alert>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '22rem 1fr' }, gap: 3, alignItems: 'start' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <LoadPanel state={state} actions={actions} />
          <PackEditor pack={state.pack} basePack={state.basePack} updatePack={actions.updatePack} />
          <ExportPanel pack={state.pack} />
        </Box>
        <Box
          className={PREVIEW_ROOT_CLASS}
          sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3, minWidth: 0 }}
        >
          {SCHEMES.map((scheme) => (
            <SchemePreview key={scheme} pack={built.pack} theme={built.theme} scheme={scheme} assets={state.assets} />
          ))}
        </Box>
      </Box>
    </Box>
  );
}
