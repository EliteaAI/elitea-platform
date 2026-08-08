import { type ReactNode, useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useParams } from '@tanstack/react-router';

import { CreateToolkitToolTabBar, ToolkitForm, ToolkitTypeSelector, type ToolkitEditorDeps, useToolkitCreate } from '@/features/toolkits';
import { t } from '@/shared/i18n';

import { useSelectedProjectId } from './lib/useSelectedProjectId';
import type { EditToolDetail } from './lib/toolkitFormTypes';

const pageSx: SxProps<Theme> = { height: '100%', display: 'flex', flexDirection: 'column' };
const tabBarSx: SxProps<Theme> = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: 1,
  borderColor: 'divider',
  padding: '0 1.5rem',
  minHeight: '3rem',
};
const contentSx: SxProps<Theme> = { flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.5rem' };
const errorSx: SxProps<Theme> = { marginBottom: '1rem' };

export interface CreateToolkitDeps {
  /** No generated `POST /elitea_core/tools/prompt_lib/{projectId}` endpoint exists yet — see `features/toolkits`' `api/toolkits.ts` module doc comment. */
  readonly createToolkit: ToolkitEditorDeps['createToolkit'];
}

export interface CreateToolkitProps {
  readonly isMCP?: boolean;
  readonly isApplication?: boolean;
  /**
   * OPTIONAL since Phase 1c. `createToolkit` is now a real generated
   * operation, so this page supplies `useToolkitCreate()` itself and callers
   * only pass `deps` to override it (tests, or a caller that needs to wrap
   * the write). It used to be required because no generated endpoint
   * existed — see the CORRECTION in `features/toolkits/api/toolkits.ts`.
   */
  readonly deps?: CreateToolkitDeps;
}

interface CreateToolkitRouteParams {
  readonly toolkitType?: string;
}

/** `ToolkitForm`'s `onSave` is a required prop, but this page always renders it with `hideOperationButtons` — see the module doc comment. */
function noopSave(): Promise<Readonly<Record<string, unknown>>> {
  return Promise.resolve({});
}

/** `toolkit_name`-flagged settings-key resolution — local duplicate of `SaveToolkitButton.tsx`'s `toolkitNameSettingsKey` (this same slice, not exported — its own budget is already at the §3.5 ceiling, see `features/toolkits/index.ts`'s own doc comment). */
function toolkitNameFromSettings(editToolDetail: EditToolDetail): string | undefined {
  const schema = editToolDetail.schema as { readonly properties?: Readonly<Record<string, { readonly toolkit_name?: boolean }>> } | undefined;
  const key = Object.keys(schema?.properties ?? {}).find((candidate) => schema?.properties?.[candidate]?.toolkit_name);
  return key === undefined ? undefined : (editToolDetail.settings?.[key] as string | undefined);
}

function resolveCreateTitle(isApplication: boolean, isMCP: boolean): string {
  if (isApplication) return t('pages.toolkits.createToolkit.titleApplication', 'New Application');
  return isMCP ? t('pages.toolkits.createToolkit.titleMcp', 'New MCP') : t('pages.toolkits.createToolkit.titleToolkit', 'New Toolkit');
}

/**
 * Ported from `apps/elitea-ui/src/pages/Toolkits/CreateToolkit.jsx` (274
 * lines) — ROUTE-027/028 `/toolkits/create[/:toolkitType]` (+ the
 * `/mcps/create[/:toolkitType]` sibling, `isMCP`; `/apps/create[/:appType]`
 * also renders this same baseline component with `isApplication` — see
 * below). Unit A4g.
 *
 * DISCLOSED DEVIATIONS:
 *  - **No ambient Formik context.** `editToolDetail`/`formValues` are
 *    explicit local state, matching every sibling `features/*`/`pages/*`
 *    port's "no Formik" convention this whole batch already established
 *    (`CreateApplication.tsx`'s own doc comment).
 *  - **No generated create-toolkit endpoint exists** (`POST /elitea_core/
 *    tools/prompt_lib/{projectId}` — see `features/toolkits`' `api/
 *    toolkits.ts` module doc comment for the full, exhaustively-verified
 *    inventory). `deps.createToolkit` is injected exactly like
 *    `ToolkitEditor.tsx`'s own `deps.createToolkit` — this page owns 100%
 *    real orchestration (type selection, dirty tracking, the save/cancel
 *    tab bar) around a network call a future route-wiring caller supplies
 *    once a real endpoint exists. There is no real caller today either way
 *    — route-to-page wiring itself is a separate, not-yet-landed pass (every
 *    route file under `src/routes/**` still renders `RouteShell` only, R1's
 *    own Wave-1 scope; confirmed directly against `src/routes/_shell/
 *    toolkits/create.$toolkitType.tsx`).
 *  - **The baseline's `CreateToolkitToolTabBar` save button used to fire a
 *    global `eventEmitter` event another component listened for.** The
 *    ALREADY-PORTED `CreateToolkitToolTabBar.tsx` (this same unit) dropped
 *    that indirection — its own doc comment: "The caller... owns: The
 *    actual save trigger and its network call." This page IS that caller —
 *    `handleSave` below builds the create-mutation body directly from
 *    `editToolDetail`/`formValues` and calls `deps.createToolkit`.
 *  - **`ToolkitForm`'s `formValues`/`formInitialValues`/`onSetFormField`
 *    track name/description separately from `editToolDetail`** (that
 *    component's own `editField`: name/description edits route through
 *    `onSetFormField`, everything else through `onChangeToolDetail` — see
 *    that file's own source). This page wires `onSetFormField` to update
 *    `formValues` state, unlike the ALREADY-LANDED `ToolkitEditor.tsx`'s
 *    create-mode body (`ToolkitEditorParts.tsx`'s `ToolkitEditorBody`),
 *    which does not pass `onSetFormField` at all — noted as an
 *    already-existing, out-of-this-unit's-current-change gap in that file,
 *    not repeated here since wiring it is a one-line addition.
 *  - **Custom-`create_url` iframe fallback DROPPED, real backend gap, not a
 *    porting shortcut.** The baseline's `toolSchema?.metadata?.interface?.
 *    create_url` (+ the sibling `EditToolkit.jsx`'s `app_url`) is the SAME
 *    class of "let this specific integration serve its own custom UI"
 *    mechanism `pages/apps/AppDetail.tsx`'s own `useAppDetail.ts` already
 *    found has NO backend support: `grep -rn "create_url\|app_url"
 *    --include="*.go" services/` (elitea-main) returns zero hits — the
 *    field is never populated by the Go backend this app talks to (same
 *    dead-legacy-plugin-runtime class as `custom_ui_route`/`ui_host`, see
 *    that hook's own doc comment for the full citation). The standard
 *    form/selector flow below is therefore the ONLY reachable path, not a
 *    narrowed one.
 *  - **GA event tracking** — dropped outright, same documented gap every
 *    other editor in this session gives (no analytics-event SDK exists).
 *  - **`isApplication` is accepted (and the title/copy branches on it) for
 *    baseline call-site parity** (the SAME component renders `/apps/create`
 *    in the baseline — `ProtectedRoutes.jsx:229-230`), but wiring the real
 *    `/apps/create` route to THIS page (vs. a separate `pages/apps`-owned
 *    page) is a decision for whoever owns route-to-page wiring / the `apps`
 *    domain (unit A6, already landed in batch 1) — not this unit's call to
 *    make unilaterally. Flagged, not silently re-architected.
 */
export function CreateToolkit({ isMCP = false, isApplication = false, deps }: CreateToolkitProps): ReactNode {
  const defaultCreateToolkit = useToolkitCreate();
  const createToolkitMutation = deps?.createToolkit ?? defaultCreateToolkit;
  const params = useParams({ strict: false }) as CreateToolkitRouteParams;
  const projectId = useSelectedProjectId();

  const [editToolDetail, setEditToolDetail] = useState<EditToolDetail | null>(null);
  const [formValues, setFormValues] = useState<Readonly<Record<string, unknown>>>({ type: params.toolkitType ?? '' });
  const [isDirty, setIsDirty] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<unknown>(undefined);

  const handleSelectTool = useCallback((detail: EditToolDetail) => {
    setEditToolDetail(detail);
    setIsDirty(true);
  }, []);

  const handleSetFormInitialValues = useCallback((updater: (prev: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>) => {
    setFormValues(updater);
  }, []);

  const handleChangeToolDetail = useCallback((updater: (prev: EditToolDetail | null) => EditToolDetail | null) => {
    setIsDirty(true);
    setEditToolDetail(updater);
  }, []);

  const handleSetFormField = useCallback((field: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleClearEditTool = useCallback(() => {
    setEditToolDetail(null);
    setFormValues({ type: params.toolkitType ?? '' });
    setIsDirty(false);
  }, [params.toolkitType]);

  const handleSave = useCallback(async () => {
    if (projectId === undefined || editToolDetail?.type === undefined) return;
    setIsCreating(true);
    setCreateError(undefined);
    try {
      const name = toolkitNameFromSettings(editToolDetail) ?? (formValues['name'] as string | undefined);
      const description = formValues['description'] as string | undefined;
      await createToolkitMutation({
        projectId,
        type: editToolDetail.type,
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        settings: editToolDetail.settings,
        meta: editToolDetail.meta,
      });
    } catch (error) {
      setCreateError(error);
    } finally {
      setIsCreating(false);
    }
  }, [projectId, editToolDetail, formValues, createToolkitMutation]);

  const title = useMemo(() => resolveCreateTitle(isApplication, isMCP), [isApplication, isMCP]);

  return (
    <Box sx={pageSx}>
      <Box sx={tabBarSx}>
        <Typography variant="headingSmall">{title}</Typography>
        {editToolDetail && (
          <CreateToolkitToolTabBar
            toolkitType={editToolDetail.type}
            isDirty={isDirty}
            isSaving={isCreating}
            isMCP={isMCP}
            isApplication={isApplication}
            onSave={() => {
              void handleSave();
            }}
            onClearEditTool={handleClearEditTool}
          />
        )}
      </Box>
      <Box sx={contentSx}>
        {createError !== undefined && (
          <Typography
            role="alert"
            variant="bodyMedium"
            sx={errorSx}
          >
            {t('pages.toolkits.createToolkit.error', 'Failed to create the toolkit.')}
          </Typography>
        )}
        {editToolDetail ? (
          <ToolkitForm
            editToolDetail={editToolDetail}
            onChangeToolDetail={handleChangeToolDetail}
            isEditing={false}
            isToolDirty={isDirty}
            hideConfigurationNameInput
            projectId={projectId}
            formValues={formValues}
            formInitialValues={formValues}
            onSetFormField={handleSetFormField}
            hideOperationButtons
            isMCP={isMCP}
            onSave={noopSave}
          />
        ) : (
          <ToolkitTypeSelector
            onSelectTool={handleSelectTool}
            setFormikInitialValues={handleSetFormInitialValues}
            isMCP={isMCP}
            isApplication={isApplication}
          />
        )}
      </Box>
    </Box>
  );
}
