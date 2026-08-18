// @ts-nocheck
/**
 * The page component for `/settings/tokens` (issue #493), and the reference
 * header for the two siblings in this directory.
 *
 * WHY `-pages/` AND NOT `src/pages/`: these compositions deep-import
 * `features/settings/**` and `entities/token/**`. `src/pages/` is inside the
 * `no-deep-slice-import` fence, and `entities/token/index.ts` states why those
 * symbols are not on the curated barrel: "its one consumer is a route, and
 * routes are outside the `no-deep-slice-import` fence". A `-`-prefixed
 * directory is what the TanStack Router generator ignores, and `-ui/`,
 * `-guards/`, `-search/` and `-lib/` are already here.
 *
 * WHY IT IS A SEPARATE MODULE AT ALL: the router plugin's code splitter moves
 * a route's `component` into its own chunk only when the route file does not
 * EXPORT that identifier (`shouldSplit = !isExported`,
 * `code-splitter/compilers.js`). This page was exported for its unit test, so
 * the splitter left it, and everything it imports, in the entry chunk.
 */
/**
 * ROUTE-057 `/settings/tokens` -> `PersonalTokens` page.
 *
 * Replaces the stub `RouteShell` with the full personal tokens management UI.
 * Composes:
 *  - `DrawerPageHeader` with search + "Generate" button
 *  - `TokensSection` for the token table (with optional search filtering)
 *  - Empty state when no tokens exist
 *  - `SettingsPreview` dialog for IDE settings preview
 *
 * Deviations from the baseline:
 *  - No `Split` layout (SettingsPreview inline — replaced with dialog)
 *  - No tour IDs
 *  - No Redux (no sidebar state)
 *  - Fetches model configuration via `useListModelsQuery` for IDE settings
 *  - Uses `useNavigate` from TanStack Router for nav to create-personal-token
 *  - Token-list fetch gates on the user's `personal_project_id` (TanStack
 *    Router context), not the currently-selected project (Warning #11) —
 *    personal tokens are not project-scoped (`/auth/token/` takes no
 *    project param)
 */
import { useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

import { useNavigate, useRouteContext } from '@tanstack/react-router';

import { DrawerPageHeader } from '@/shared/ui/settings/DrawerPageHeader';
import { useListModelsQuery, type ConfigModel } from '@/shared/api/configurationsApi';
import { TokensSection } from '@/features/settings/ui/personal-tokens/TokensSection';
import { SettingsPreview } from '@/features/settings/ui/personal-tokens/SettingsPreview';
import { t } from '@/shared/i18n';
import { useListTokensQuery } from '@/entities/token/api/tokenApi';
import { useSelectedProjectStore } from '@/widgets/app-shell';
import { useProjectOptions } from '@/widgets/sidebar';
import { getConfig } from '@/shared/config';
import { isPublicProject } from '@/entities/project';

/**
 * `personal_project_id` from the TanStack Router root context's
 * `auth.getUser()` (`src/app/router-context.ts`'s `AuthUser.
 * personal_project_id` — outside this cluster's file scope, read
 * structurally rather than imported, per `no-upward-from-features`; the
 * same seam `features/settings/ui/personal-tokens/TokensTable.tsx`
 * duplicates independently, per that pattern's own established
 * "no shared primitive yet, each call site copies the couple of lines"
 * convention).
 */
interface PersonalProjectIdContext {
  readonly auth?: {
    readonly getUser?: () => { readonly personal_project_id?: string } | undefined;
  };
}

function isPersonalProjectIdContext(value: unknown): value is PersonalProjectIdContext {
  return typeof value === 'object' && value !== null;
}

function selectPersonalProjectId(context: unknown): string | undefined {
  if (!isPersonalProjectIdContext(context)) return undefined;
  return context.auth?.getUser?.()?.personal_project_id;
}

/**
 * old-app: prefers a model marked default FOR the selected project, then
 * any model belonging to the selected project, then any default model,
 * then the first item (Warning #6) — project-scoping always wins over a
 * generic `default` flag, since `include_shared: true` can surface a
 * `default` model from an unrelated shared project. Extracted to a pure
 * function (rather than inlined in the component) to keep
 * `PersonalTokensPage`'s cyclomatic complexity under the project's gate.
 */
function selectDefaultModel(
  configurations: readonly ConfigModel[],
  projectId: string,
): ConfigModel | undefined {
  return (
    configurations.find((m) => m.default === true && m.project_id === projectId) ??
    configurations.find((m) => m.project_id === projectId) ??
    configurations.find((m) => m.default === true) ??
    configurations[0]
  );
}

/** old-app: `selectedProjectId !== PUBLIC_PROJECT_ID` (Warning #5), extracted for the same complexity reason as `selectDefaultModel` above. */
function selectIsPublicProject(projectId: string): boolean {
  const config = getConfig();
  if (config.status !== 'ok') return false;
  return isPublicProject(projectId, config.config.vite_public_project_id);
}

/** The configured public project id, or `''` when config has not resolved. */
function selectPublicProjectId(): string {
  const config = getConfig();
  return config.status === 'ok' ? config.config.vite_public_project_id : '';
}

export function PersonalTokensPage() {
  const navigate = useNavigate();
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');
  const routeContext: unknown = useRouteContext({ strict: false });
  const personalProjectId = selectPersonalProjectId(routeContext);
  const { data: tokens = [], isFetching } = useListTokensQuery({
    enabled: !!personalProjectId,
  });
  const { data: modelsData, isFetching: isFetchingModels } = useListModelsQuery(
    { projectId, include_shared: true },
    { skip: !projectId },
  );
  const configurations = useMemo(
    () => modelsData?.items ?? [],
    [modelsData?.items],
  );

  const isPublicProjectSelected = useMemo(() => selectIsPublicProject(projectId), [projectId]);

  /*
   * Names for the token table's binding column. The app's EXISTING projects
   * query (`useProjectOptions` -> the generated `useListProjects`), reused
   * as-is: same hook, same react-query key as the project switcher, so this
   * page adds no second fetch and no new key. `TokensTable` lives in
   * `features/` and may not import `widgets/` (R-L1), which is why the map is
   * built here and passed down.
   */
  const { projects } = useProjectOptions(selectPublicProjectId());
  const projectNames = useMemo(
    () => new Map(projects.map((project) => [String(project.id), project.name])),
    [projects],
  );

  const [search, setSearch] = useState('');
  const theme = useTheme();
  const styles = getStyles(theme);

  /* ── model configuration for IDE settings (Warning #11) ────────────── */

  // Derived (not `useState` + setState-during-render): recomputes whenever
  // `configurations`/`projectId` change, matching the old app's own effect
  // dependency list (`[isSuccess, configurations, selectedProjectId]`).
  // `selectDefaultModel` above carries the Warning #6 selection rationale.
  const modelConfiguration = useMemo(() => {
    const defaultModel = selectDefaultModel(configurations, projectId);
    if (!defaultModel) return null;
    return { id: defaultModel.id ?? '', name: defaultModel.name };
  }, [configurations, projectId]);

  /* ── navigation to create page ──────────────────────────────────────── */

  const onAddPersonalToken = useCallback(() => {
    void navigate({ to: '/settings/create-personal-token' });
  }, [navigate]);

  /* ── preview callback (Blocker #2) ─────────────────────────────────── */

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewToken, setPreviewToken] = useState('');

  const handlePreview = useCallback((token: { uuid: string; name: string; token: string }) => {
    setPreviewToken(token.token);
    setPreviewOpen(true);
  }, []);

  const isAddButtonDisabled = useMemo(
    () => isFetchingModels || configurations.length === 0,
    [isFetchingModels, configurations.length],
  );
  const showTokenPreview = useMemo(
    () => !!modelConfiguration?.id && !isPublicProjectSelected,
    [modelConfiguration?.id, isPublicProjectSelected],
  );

  /* ── empty state ────────────────────────────────────────────────────── */

  if (isFetching) {
    return (
      <Box sx={styles.loadingContainer}>
        <CircularProgress />
      </Box>
    );
  }

  if (tokens.length === 0) {
    return (
      <Box sx={styles.emptyStateContainer}>
        <Typography
          variant="headingMedium"
          color="text.secondary"
        >
          {t('entities.token.emptyState.title', 'No tokens yet')}
        </Typography>
        <Typography
          variant="bodyMedium"
          color="text.secondary"
          sx={styles.emptyStateDesc}
        >
          {t('entities.token.emptyState.description', 'Create your first API token.')}
        </Typography>
        <Paper
          elevation={0}
          sx={styles.emptyStateButton}
          onClick={onAddPersonalToken}
        >
          {t('entities.token.emptyState.createButton', 'Create token')}
        </Paper>
      </Box>
    );
  }

  /* ── main content ───────────────────────────────────────────────────── */

  return (
    <Paper
      elevation={0}
      sx={styles.root}
    >
      <DrawerPageHeader
        title={t('entities.token.pageTitle', 'Personal Tokens')}
        showSearchInput
        showAddButton
        slotProps={{
          searchInput: {
            search,
            onChangeSearch: setSearch,
            placeholder: t('entities.token.searchPlaceholder', 'Search tokens...'),
          },
          addButton: {
            onAdd: onAddPersonalToken,
            disabled: isAddButtonDisabled,
            tooltip: t('entities.token.addTooltip', 'Generate new token'),
          },
        }}
      />
      <Box sx={styles.content}>
        <TokensSection
          search={search}
          showPreview={showTokenPreview}
          onPreviewToken={handlePreview}
          projectNames={projectNames}
        />
      </Box>

      {/* SettingsPreview dialog (Blocker #2) */}
      <Dialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogContent sx={styles.dialogContent}>
          <SettingsPreview
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
            token={previewToken}
            model={modelConfiguration}
            projectId={projectId}
          />
        </DialogContent>
      </Dialog>
    </Paper>
  );
}

const getStyles = (theme: Theme): {
  root: SxProps<Theme>;
  content: SxProps<Theme>;
  loadingContainer: SxProps<Theme>;
  emptyStateContainer: SxProps<Theme>;
  emptyStateDesc: SxProps<Theme>;
  emptyStateButton: SxProps<Theme>;
  dialogContent: SxProps<Theme>;
} => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    borderRadius: 'var(--el-shape-radiusSm, 0px)',
  },
  content: {
    flex: 1,
    minHeight: 0,
    padding: '0 1.5rem 1.5rem',
  },
  loadingContainer: {
    height: '50vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    flex: 1,
    padding: '2rem',
  },
  emptyStateDesc: {
    marginBottom: '1rem',
  },
  emptyStateButton: {
    padding: '0.5rem 1.5rem',
    borderRadius: 'var(--el-shape-radiusSm, 4px)',
    cursor: 'pointer',
    backgroundColor: 'primary.main',
    color: theme.vars.palette.common.white,
    fontWeight: 600,
  },
  dialogContent: {
    padding: 0,
    minHeight: '28rem',
    width: '48rem',
  },
});
