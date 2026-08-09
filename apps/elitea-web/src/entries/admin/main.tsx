import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Admin build entry (spec §7.4, contract C15). Served by the Go adminui handler
 * (services/elitea-main/internal/api/adminui/handler.go), which replaces the
 * `<!-- admin_ui_config -->` marker in this entry's index.html with a script
 * defining `window.admin_ui_config`. The admin route group arrives with unit A14.
 */

declare global {
  interface Window {
    admin_ui_config?: {
      vite_server_url?: string;
      user_email?: string;
      permissions?: string[];
      roles?: string[];
    };
  }
}

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['projects.view', 'projects.edit', 'users.view', 'users.edit', 'roles.view', 'roles.edit'],
  editor: ['projects.view', 'projects.edit', 'users.view'],
  viewer: ['projects.view', 'users.view'],
};

const ALL_PERMISSIONS = Array.from(new Set(Object.values(DEFAULT_ROLE_PERMISSIONS).flat()));

const STORAGE_KEY = 'admin_role_permissions';
const store = window.sessionStorage;

function loadPermissions(): Record<string, string[]> {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string[]>;
  } catch {
    // ignore
  }
  return { ...DEFAULT_ROLE_PERMISSIONS };
}

function savePermissions(p: Record<string, string[]>) {
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

function RolesTable() {
  const [permissions, setPermissions] = useState<Record<string, string[]>>(loadPermissions);
  const [saved, setSaved] = useState(false);
  const roles = Object.keys(DEFAULT_ROLE_PERMISSIONS);

  const toggle = (role: string, perm: string) => {
    setPermissions((prev) => {
      const next = { ...prev, [role]: prev[role] ? [...prev[role]] : [] };
      if (next[role]?.includes(perm)) {
        next[role] = next[role].filter((p) => p !== perm);
      } else {
        next[role] = [...(next[role] ?? []), perm];
      }
      return next;
    });
    setSaved(false);
  };

  const handleSave = () => {
    savePermissions(permissions);
    setSaved(true);
  };

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Permission</th>
            {roles.map((r) => (
              <th key={r}>{r}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ALL_PERMISSIONS.map((perm) => (
            <tr key={perm}>
              <td>{perm}</td>
              {roles.map((r) => (
                <td key={r}>
                  <input
                    type="checkbox"
                    checked={permissions[r]?.includes(perm) ?? false}
                    onChange={() => toggle(r, perm)}
                    aria-label={`${r} ${perm}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={handleSave}>Save</button>
      {saved && <span>Saved</span>}
    </>
  );
}

function UsersTable() {
  return (
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Role</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{window.admin_ui_config?.user_email ?? 'admin@example.com'}</td>
          <td>admin</td>
        </tr>
      </tbody>
    </table>
  );
}

function AdminApp() {
  const path = window.location.pathname;
  const isRoles = path.includes('/roles');
  const isUsers = !isRoles;
  return (
    <main>
      <h1>Elitea Admin</h1>
      <nav>
        <a href="/admin/app/users">Users</a>
        {' | '}
        <a href="/admin/app/roles">Roles &amp; Permissions</a>
      </nav>
      {isRoles && (
        <section aria-label="Role permission matrix">
          <h2>Roles</h2>
          <RolesTable />
        </section>
      )}
      {isUsers && <UsersTable />}
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
