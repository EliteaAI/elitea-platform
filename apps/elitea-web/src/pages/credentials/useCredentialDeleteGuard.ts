/**
 * pages/credentials/useCredentialDeleteGuard.ts — the "don't let a project's
 * last vectorstorage/embedding credential be deleted" guard used by
 * `useCredentialFormController.ts` (unit A7, finding A7-pages/2). Split into
 * its own sibling file purely to keep `useCredentialFormController.ts`
 * under the §3.5 400-line file-length budget — the same reason
 * `CredentialFormFields.tsx`/`CredentialTypeSelector.tsx` are their own
 * files alongside `CredentialForm.tsx`.
 */
import { useConfigurationsList } from '@/features/credentials';
import { t } from '@/shared/i18n';

const PROTECTED_DELETE_GUARD_SECTIONS = new Set(['vectorstorage', 'embedding']);

export interface DeleteGuard {
  readonly canDelete: boolean;
  readonly deleteDisabledReason: string | undefined;
}

/**
 * Ports `[fsd]/features/credentials/ui/credentials-tab-bar/CredentialsControls.jsx`'s
 * `isLastInSection` guard: a project's last `vectorstorage`/`embedding`
 * config may not be deleted, because every agent/chat relying on that
 * project-wide config would break. Baseline computes
 * `totalAvailable = (sectionConfigs?.total ?? 0) + (sectionConfigs?.shared?.total ?? 0)`
 * from a `pageSize: 2, include_shared: true, shared_limit: 2` query and
 * disables Delete (with a tooltip) when `totalAvailable <= 1` — reproduced
 * here via `useConfigurationsList` (already this unit's own public API;
 * `getConfigurationsBySection`'s dedicated hook wrapper lives outside this
 * cluster's file scope, see `useDeleteGuard`'s query call below).
 *
 * `sectionGuardEnabled` false (query still loading, or the section isn't
 * protected, or permission already says no) never fabricates a false
 * "you may delete this" — `sectionTotal` defaults to 0 while the count is
 * in flight, which (deliberately, matching baseline) reads as "last one,
 * block it" until the real count resolves, not the other way around.
 * Isolated from `useDeleteGuard` for the same complexity-budget reason
 * `useCredentialFormController.ts`'s own `performSave`/`canSubmit` are
 * split from that file's hook body.
 */
function resolveDeleteGuard(canDeleteFromPermission: boolean, section: string | undefined, sectionTotal: number, sectionGuardEnabled: boolean): DeleteGuard {
  const isLastInSection = sectionGuardEnabled && sectionTotal <= 1;
  if (!canDeleteFromPermission || !isLastInSection) {
    return { canDelete: canDeleteFromPermission && !isLastInSection, deleteDisabledReason: undefined };
  }
  const configTypeLabel =
    section === 'vectorstorage'
      ? t('credentials.form.deleteLastConfigTypeVectorstore', 'pgVector')
      : t('credentials.form.deleteLastConfigTypeEmbedding', 'embedding model');
  return {
    canDelete: false,
    deleteDisabledReason: t(
      'credentials.form.deleteLastConfigReason',
      'Cannot delete the only {{configType}} configuration. At least one is required for the project.',
      { configType: configTypeLabel },
    ),
  };
}

/**
 * Wraps the `useConfigurationsList` section-count query + `resolveDeleteGuard`
 * call together. `isEditMode` (rather than the whole `CredentialFormMode`)
 * keeps this file decoupled from `useCredentialFormController.ts`'s own
 * types — the only thing this guard ever needed from `mode` was
 * `mode.kind === 'edit'` (no protected-section guard applies to a
 * not-yet-created credential).
 *
 * OUT-OF-SCOPE FOLLOW-UP (`features/credentials/ui/CredentialsControls.tsx`,
 * outside this cluster's own file scope — do not edit it from here): that
 * component's render root is `{!canDelete && deleteDisabledReason ?
 * <Tooltip><Box component="span">{menu}</Box></Tooltip> : menu}` — two
 * DIFFERENTLY-SHAPED element trees at the same position. Because `canDelete`
 * now legitimately changes after mount (this guard's query resolving from
 * its conservative "blocked" default once the real section count arrives),
 * React unmounts and remounts the whole `<ControlsDropdown>` subtree
 * whenever that boundary is crossed, destroying any menu that happened to
 * be open (`anchorEl`/`confirmingKey`/`submenu` all reset) — reproduced by
 * `CredentialForm.test.tsx`'s "keeps Delete enabled…" regression test,
 * which has to poll-and-reclick to work around it rather than opening the
 * menu once. The fix belongs in that file: make the wrapper shape
 * unconditional, e.g. always render `<Tooltip title={!canDelete ?
 * (deleteDisabledReason ?? '') : ''}><Box component="span">{menu}
 * </Box></Tooltip>` (MUI's `Tooltip` no-ops on an empty `title`), so
 * `canDelete` toggling only ever changes props, never the tree shape.
 */
export function useCredentialDeleteGuard(isEditMode: boolean, projectId: string, canDeleteFromPermission: boolean, section: string | undefined): DeleteGuard {
  const sectionGuardEnabled = isEditMode && section !== undefined && PROTECTED_DELETE_GUARD_SECTIONS.has(section);
  const sectionConfigs = useConfigurationsList(
    { projectId, pageSize: 2, includeShared: true, sharedLimit: 2, ...(section !== undefined ? { section } : {}) },
    { enabled: sectionGuardEnabled },
  );
  const sectionTotal = (sectionConfigs.data?.total ?? 0) + (sectionConfigs.data?.shared?.total ?? 0);
  return resolveDeleteGuard(canDeleteFromPermission, section, sectionTotal, sectionGuardEnabled);
}
