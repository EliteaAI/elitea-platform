import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Admin build entry (spec §7.4, contract C15). Served by the Go adminui handler
 * (services/elitea-main/internal/api/adminui/handler.go), which replaces the
 * `<!-- admin_ui_config -->` marker in this entry's index.html with a script
 * defining `window.admin_ui_config`. The admin route group arrives with unit A14.
 */
function AdminApp() {
  return (
    <main>
      <h1>Elitea Admin</h1>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('elitea-web admin: #root container missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
