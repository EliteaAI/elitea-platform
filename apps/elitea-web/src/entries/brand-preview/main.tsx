/**
 * Brand-preview entry root (ADR-0024 WP9) — the `preview/app.html` a
 * branding package ships. Modelled on the maintenance entry: no
 * `<AppProviders>`, no query client, one `ThemeProvider` over the compiled
 * default pack for the page's own chrome. The pack under preview gets its
 * own scoped theme inside `BrandPreviewApp`.
 *
 * `defaultMode="light"`: the page has no mode toggle of its own; both
 * schemes of the pack under preview are always shown side by side.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';

import { DEFAULT_BRAND_PACK, buildEliteaTheme } from '@/shared/brand';

import { readInlineBrandPack } from '@/entries/brand-preview/lib/bootstrap';
import { BrandPreviewApp } from '@/entries/brand-preview/ui/BrandPreviewApp';
import '@/entries/brand-preview/reset.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('elitea-web brand-preview: #root container missing from index.html');
}

const chromeTheme = buildEliteaTheme(DEFAULT_BRAND_PACK);
const bootstrap = readInlineBrandPack(document);

createRoot(container).render(
  <StrictMode>
    <ThemeProvider theme={chromeTheme} defaultMode="light">
      <CssBaseline />
      <BrandPreviewApp bootstrap={bootstrap} />
    </ThemeProvider>
  </StrictMode>,
);
