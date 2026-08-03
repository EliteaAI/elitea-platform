/**
 * Maintenance entry root — wires up a standalone MUI theme and renders the
 * MaintenancePage (spec §7.4).
 *
 * Unlike the main SPA this entry point has no `<AppProviders>` wrapper and no
 * react-query provider — it is a self-contained splash page, so the theme is
 * defined here directly.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import MaintenanceApp from '@/entries/maintenance/components/MaintenancePage';

import theme from '@/entries/maintenance/theme';
import '@/entries/maintenance/reset.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('elitea-web maintenance: #root container missing from maintenance.html');
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider theme={theme} defaultMode="light">
      <CssBaseline />
      <MaintenanceApp />
    </ThemeProvider>
  </StrictMode>,
);
