/**
 * Admin › Projects — the deployment-wide project list (unit A14, issue #200).
 *
 * Reference (read-only): `frontends/admin_ui/frontend/src/pages/ProjectsPage/`
 * — 1884 lines across seven files, the largest page in the unit. Rewritten
 * against this app's stack: Redux Toolkit → TanStack Query
 * (`./api/adminProjectsApi`), axios → `eliteaFetch`, react-router → TanStack
 * Router (`./router`), MUI 7 → 9, and this app's `shared/ui` primitives instead
 * of admin_ui's own component set. State lives in `./useAdminProjectsPage`.
 *
 * ## What is real and what is not
 *
 * Of the reference's five mutations:
 *
 *  - **suspend / unsuspend** — real. The handler existed in elitea-main before
 *    this unit but was mounted on NO ROUTE; A14 routes and hardens it, gated on
 *    `projects.projects.projects.edit` and covered by write-then-re-read tests.
 *  - **add project admin** and **change a member's role** — real. Both reach
 *    `POST`/`PUT /admin/users/administration/{projectID}`, which answered 501
 *    before this unit because the handler treated `administration` as a
 *    project-less scope; the project id is in that path, so it is not.
 *  - **create project** and **delete project** — NOT implemented, and rendered
 *    unavailable with the reason on the page. See below.
 *
 * The reference's Excel export is also rendered disabled with its reason: it
 * builds an .xlsx through a spreadsheet library this app does not depend on.
 *
 * Nothing here is a button that no-ops.
 *
 * ## Why create and delete are unavailable rather than built
 *
 * Neither is one endpoint. `legacy/plugins/projects/utils/project_steps.py`
 * runs NINE steps to create a project — the row and its quota and statistics,
 * the object-storage buckets, the `p_<id>` tenant schema, the permission set,
 * a system user, that user's token, the vault secrets, a RabbitMQ vhost and
 * user, the InfluxDB databases — and deletion runs the same nine in reverse,
 * including `DROP SCHEMA p_<id> CASCADE`.
 *
 * So the question the issue asks — what should deleting a project do about the
 * tenant schema and data? — has a definite answer, and it is the reason not to
 * implement it here: dropping `p_<id>` is irreversible, and doing it from a Go
 * handler that does not also tear down the vault entry, the RabbitMQ vhost, the
 * Influx databases, the buckets and the system token would destroy the tenant's
 * data while leaving the infrastructure around it orphaned. Creation has the
 * mirror problem: a project row without its schema, secrets and system user is
 * a project every subsequent request fails against.
 *
 * Provisioning is its own unit of work, not a side effect of porting a table.
 * Until it exists, both controls are rendered DISABLED with that reason in
 * their tooltip — visible on the page, not only in the tracker.
 *
 * ## Authorisation
 *
 * `window.admin_ui_config.permissions` is presentation state and never a gate —
 * see `./adminUiConfig`, and note that the Go handler injecting it HARDCODES
 * the list for every session. The listing is gated server-side on
 * `projects.projects.projects.view` and every write on its own permission,
 * resolved from `auth_core__user_role` per request. Projects are a tenancy
 * boundary: hiding a control here changes what an operator SEES, and a crafted
 * request is still refused by the server.
 */
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { SimpleSearchBar } from '@/shared/ui/SimpleSearchBar';
import { t } from '@/shared/i18n';
import { drawerPage } from '@/features/settings';

import { AdminProjectsTable } from './AdminProjectsTable';
import { ProjectActivityDrawer } from './ProjectActivityDrawer';
import { ProjectMemberDialog } from './ProjectMemberDialog';
import { ADMIN_PROJECTS_PAGE_SIZE, useAdminProjectsPage } from './useAdminProjectsPage';

const { DrawerPage } = drawerPage;

/**
 * The one reason both provisioning controls carry. Written once so the page and
 * its tests cannot drift into two different explanations of the same gap.
 */
const PROVISIONING_UNAVAILABLE = t(
  'pages.admin.projects.provisioningUnavailable',
  'Unavailable: creating or deleting a project provisions and tears down the tenant schema, object storage, vault secrets, the message-broker vhost and a system account. That pipeline has not been ported, and doing half of it would leave orphaned infrastructure or destroy tenant data.',
);

export function AdminProjects() {
  const state = useAdminProjectsPage();

  const { total, page } = state;
  const lastPage = total === 0 ? 0 : Math.ceil(total / ADMIN_PROJECTS_PAGE_SIZE) - 1;
  const firstShown = total === 0 ? 0 : page * ADMIN_PROJECTS_PAGE_SIZE + 1;
  const lastShown = Math.min((page + 1) * ADMIN_PROJECTS_PAGE_SIZE, total);

  const createLabel = t('pages.admin.projects.action.create', 'Create project');
  const deleteLabel = t('pages.admin.projects.action.delete', 'Delete projects');

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
          {t('pages.admin.projects.title', 'Projects')}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <SimpleSearchBar
            value={state.search}
            onChange={state.onSearchChange}
            placeholder={t('pages.admin.projects.search', 'Search by name, ID or owner')}
            data-testid="admin-projects-search"
          />

          {/*
            Create and delete. Both are DISABLED with the reason rather than
            omitted, so the gap is visible where an operator looks for the
            control — and never as a button that reports success. See this
            file's header for what each would have to do.
          */}
          <Tooltip title={PROVISIONING_UNAVAILABLE}>
            <span>
              <Button variant="contained" size="small" startIcon={<AddIcon />} disabled>
                {createLabel}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={PROVISIONING_UNAVAILABLE}>
            <span>
              <IconButton disabled aria-label={deleteLabel}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          {/*
            Export. admin_ui builds an .xlsx through a spreadsheet library that
            elitea-web does not depend on, so there is nothing behind this
            control yet — the same call the Users port made.
          */}
          <Tooltip
            title={t(
              'pages.admin.projects.action.exportUnavailable',
              'Export is unavailable: the spreadsheet export has not been ported yet',
            )}
          >
            <span>
              <IconButton
                disabled
                aria-label={t('pages.admin.projects.action.export', 'Export to Excel')}
              >
                <FileDownloadOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      <Tabs value={state.activeTab} onChange={state.onTabChange} sx={{ minHeight: '2.5rem' }}>
        <Tab
          label={`${t('pages.admin.projects.tab.team', 'Team Projects')} (${state.counts.team})`}
          sx={{ textTransform: 'none', minHeight: '2.5rem' }}
        />
        <Tab
          label={`${t('pages.admin.projects.tab.personal', 'Personal Projects')} (${state.counts.personal})`}
          sx={{ textTransform: 'none', minHeight: '2.5rem' }}
        />
      </Tabs>

      {state.errorMessage ? (
        <Alert severity="error" onClose={state.onDismissError}>
          {state.errorMessage}
        </Alert>
      ) : null}

      {state.isError ? (
        <Alert severity="error">
          {t('pages.admin.projects.error.load', 'Failed to load projects.')}
        </Alert>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <AdminProjectsTable
            projects={state.rows}
            isLoading={state.isFetching}
            sortField={state.sortField}
            sortDirection={state.sortDirection}
            onSort={state.onSort}
            onToggleSuspended={state.onToggleSuspended}
            onOpenMembers={state.onOpenMembers}
            onOpenActivity={state.onOpenActivity}
            pendingIds={state.pendingIds}
          />

          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: '0.75rem',
              paddingTop: '0.5rem',
            }}
          >
            <Typography variant="bodyMedium" color="text.secondary">
              {`${firstShown}–${lastShown} / ${total}`}
            </Typography>
            <Button size="small" disabled={page === 0} onClick={state.onPreviousPage}>
              {t('pages.admin.projects.pagination.previous', 'Previous')}
            </Button>
            <Button size="small" disabled={page >= lastPage} onClick={state.onNextPage}>
              {t('pages.admin.projects.pagination.next', 'Next')}
            </Button>
          </Box>
        </Box>
      )}

      <ProjectMemberDialog project={state.memberProject} onClose={state.onCloseMembers} />
      <ProjectActivityDrawer project={state.activityProject} onClose={state.onCloseActivity} />
    </DrawerPage>
  );
}
