import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Maintenance build entry (spec §7.4): vite-plugin-singlefile inlines this whole
 * bundle into a single self-contained maintenance.html. The real splash content
 * (absorbing frontends/Maintenance-UI) arrives with unit A15.
 */
function MaintenanceApp() {
  return (
    <main>
      <h1>Elitea</h1>
      <p>Scheduled maintenance is in progress.</p>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('elitea-web maintenance: #root container missing from maintenance.html');
}

createRoot(container).render(
  <StrictMode>
    <MaintenanceApp />
  </StrictMode>,
);
