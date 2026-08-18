/**
 * Admin › Roles — the platform permission matrix (unit A14, issue #200).
 *
 * Reference (read-only): `frontends/admin_ui/frontend/src/pages/RolesPage/`.
 * Rewritten against this app's stack: Redux Toolkit → TanStack Query
 * (`./api/adminRolesApi`), axios → `eliteaFetch`, react-router → TanStack Router
 * (`./router`), MUI 7 → 9. State and handlers live in `./useAdminRolesPage`.
 *
 * ## What is real and what is not
 *
 * All four tabs and all three writes are REAL. Two of the endpoints
 * (`PUT`, `POST`) had no route at all before this unit, and the `GET` ignored
 * its `{scope}` segment so the Public and Support tabs were rendering the
 * central administration matrix; `internal/api/v2/admin/roles.go` implements all
 * of them for real, covered by write-then-re-read tests.
 *
 * The one thing that can be unavailable is the SUPPORT tab, and only when the
 * deployment has not configured a support project (`SUPPORT_PROJECT_ID`). That
 * is the pylon behaviour too — its handler 404s with the same meaning — and it
 * is rendered as the server's own sentence rather than as "Failed to load", so
 * the operator is told what to set.
 *
 * ## Authorisation
 *
 * `window.admin_ui_config.permissions` is presentation state and never a gate —
 * see `./adminUiConfig`. Both writes are gated server-side on
 * `configuration.roles.permissions.edit` and the read on `…view`, resolved from
 * `auth_core__user_role` per request.
 *
 * One deliberate difference from the reference: it disabled the `super_admin`
 * COLUMN for anyone who was not a super admin. No server rule has ever backed
 * that — neither pylon's `permissions.py` nor `roles.go` treats `super_admin`
 * specially here — so reproducing it would be presentation posing as
 * authorisation, the inversion #11 got wrong in the gateway. The column a
 * SERVER actually refuses, `system`, is the one rendered disabled.
 */
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

import { SimpleSearchBar } from '@/shared/ui/SimpleSearchBar';
import { t } from '@/shared/i18n';
import { DrawerPage } from '@/shared/ui/settings/DrawerPage';

import { PermissionMatrix } from './PermissionMatrix';
import { useAdminRolesPage, type AdminRolesPageState } from './useAdminRolesPage';


function savedText(message: string): string {
  return message === 'synced'
    ? t('pages.admin.roles.saved.synced', 'Permissions synced to shared projects.')
    : t('pages.admin.roles.saved.matrix', 'Permissions saved.');
}

function errorText(message: string): string {
  if (message === 'save') return t('pages.admin.roles.error.save', 'Failed to save permissions.');
  if (message === 'sync') {
    return t('pages.admin.roles.error.sync', 'Failed to sync permissions to projects.');
  }
  return message;
}

function RolesActions({ state }: { readonly state: AdminRolesPageState }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      {state.onApplyToProjects && !state.isDirty ? (
        <Button
          variant="contained"
          size="small"
          disabled={state.isSyncing || state.isSaving}
          onClick={state.onApplyToProjects}
        >
          {t('pages.admin.roles.action.applyToProjects', 'Apply to Projects')}
        </Button>
      ) : null}
      {state.canEdit && state.isDirty ? (
        <>
          <Button variant="outlined" size="small" disabled={state.isSaving} onClick={state.onDiscard}>
            {t('pages.admin.roles.action.discard', 'Discard')}
          </Button>
          <Button variant="contained" size="small" disabled={state.isSaving} onClick={state.onSave}>
            {t('pages.admin.roles.action.save', 'Save')}
          </Button>
        </>
      ) : null}
    </Box>
  );
}

function RolesBody({ state }: { readonly state: AdminRolesPageState }) {
  if (state.isError) {
    return (
      <Alert severity="warning" data-testid="admin-roles-unavailable">
        {state.unavailableReason ??
          t('pages.admin.roles.error.load', 'Failed to load the permission matrix.')}
      </Alert>
    );
  }
  if (!state.rows) {
    return (
      <Typography variant="bodyMedium" color="text.secondary">
        {t('pages.admin.roles.loading', 'Loading permissions…')}
      </Typography>
    );
  }
  return (
    <PermissionMatrix
      rows={state.rows}
      roles={state.roles}
      search={state.search}
      readOnly={!state.canEdit}
      onChange={state.onChange}
    />
  );
}

export function AdminRoles() {
  const state = useAdminRolesPage();

  return (
    <DrawerPage sx={{ padding: '1rem 1.5rem', gap: '0.75rem' }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {t('pages.admin.roles.title', 'Roles')}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <SimpleSearchBar
            value={state.search}
            onChange={state.onSearchChange}
            placeholder={t('pages.admin.roles.search', 'Search permissions')}
            data-testid="admin-roles-search"
          />
          <RolesActions state={state} />
        </Box>
      </Box>

      <Tabs value={state.activeTab} onChange={state.onTabChange} sx={{ minHeight: '2.5rem' }}>
        <Tab
          label={t('pages.admin.roles.tab.admin', 'Admin Roles')}
          sx={{ textTransform: 'none', minHeight: '2.5rem' }}
        />
        <Tab
          label={t('pages.admin.roles.tab.standard', 'Standard Roles')}
          sx={{ textTransform: 'none', minHeight: '2.5rem' }}
        />
        <Tab
          label={t('pages.admin.roles.tab.public', 'Public Project')}
          sx={{ textTransform: 'none', minHeight: '2.5rem' }}
        />
        <Tab
          label={t('pages.admin.roles.tab.support', 'Support Project')}
          sx={{ textTransform: 'none', minHeight: '2.5rem' }}
        />
      </Tabs>

      <Box sx={{ height: '0.25rem' }}>{state.isFetching ? <LinearProgress /> : null}</Box>

      {state.errorMessage ? (
        <Alert severity="error" onClose={state.onDismissError}>
          {errorText(state.errorMessage)}
        </Alert>
      ) : null}
      {state.savedMessage ? (
        <Alert severity="success" onClose={state.onDismissSaved}>
          {savedText(state.savedMessage)}
        </Alert>
      ) : null}

      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <RolesBody state={state} />
      </Box>
    </DrawerPage>
  );
}
