/**
 * Admin › Configuration › LLM Proxy — **Providers**.
 *
 * ## What this screen makes possible
 *
 * Publishing an LLM provider credential once, for the whole platform, instead of
 * once per project. That was always what the gateway resolved — the caller's
 * project plus the public project's `shared = true` rows (issue #316) — but the
 * only way to author one was to open the public project's ordinary settings
 * screen, know that it was the global scope, and be a member of it.
 *
 * ## `status_ok` is the column that decides whether anything happens
 *
 * The gateway admits `status_ok = true` and nothing else. Provider admission
 * runs on every write, so a credential whose endpoint or key does not resolve is
 * stored, listed, and completely inert — a state that has no other display
 * anywhere in the product. It is therefore the first column, not a detail.
 *
 * ## Unsealed secrets are reported as findings
 *
 * A write through this platform seals the key into the vault and stores a
 * reference. A row imported from a legacy deployment can still hold a literal,
 * and that value is readable by every holder of the project-scoped configuration
 * permissions on the public project. The server reports `sealed: false` for such
 * a row without ever sending the value, and this panel surfaces it — re-saving
 * the credential is the fix.
 */
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { LlmProviderDialog } from './LlmProviderDialog';
import { providerTypeLabel } from './llmProviderForm';
import { configFailureReason } from './api/adminConfigurationApi';
import { SharedScopeWarning } from './LlmProviderScopeWarning';
import {
  useAdminLlmProviders,
  useCreateAdminLlmProvider,
  useDeleteAdminLlmProvider,
  useUpdateAdminLlmProvider,
  type LlmProvider,
  type LlmProviderDraft,
} from './api/adminLlmProvidersApi';

/** A stable empty list, so a pending query does not invalidate every memo. */
const EMPTY_PROVIDERS: readonly LlmProvider[] = [];

/** The rows holding a secret this platform did not seal. */
function unsealedProviders(items: readonly LlmProvider[]): readonly LlmProvider[] {
  return items.filter((item) => item.secrets.some((secret) => !secret.sealed));
}

/**
 * The four things that can be wrong at once, each its own statement.
 *
 * Extracted so the panel stays its own state machine rather than a stack of
 * conditionals — the same complexity-gate split `AdminLlmProxyEditor` made for
 * `ModelCatalogueAlerts`, for the same reason.
 */
function ProviderAlerts({
  loadError,
  saveError,
  deleteError,
  unsealed,
}: {
  readonly loadError: unknown;
  readonly saveError: string | undefined;
  readonly deleteError: unknown;
  readonly unsealed: readonly LlmProvider[];
}): ReactNode {
  return (
    <>
      {loadError != null ? (
        <Alert severity="warning" data-testid="llm-providers-load-error">
          {configFailureReason(loadError) ??
            t('pages.admin.llmProviders.loadError', 'Failed to load the platform providers.')}
        </Alert>
      ) : null}

      {saveError !== undefined ? (
        <Alert severity="error" data-testid="llm-providers-save-error">
          {saveError}
        </Alert>
      ) : null}

      {deleteError != null ? (
        <Alert severity="error" data-testid="llm-providers-delete-error">
          {configFailureReason(deleteError) ??
            t('pages.admin.llmProviders.deleteError', 'Failed to delete the provider.')}
        </Alert>
      ) : null}

      {/* A finding, not a footnote: the value is readable by every holder of the
          project-scoped configuration permissions on the public project, and
          re-saving the credential is what fixes it. */}
      {unsealed.length > 0 ? (
        <Alert severity="warning" data-testid="llm-providers-unsealed">
          {t(
            'pages.admin.llmProviders.unsealed',
            'Some platform providers store their key directly in the configuration row rather than in the vault. Re-save each one to seal it: {{names}}',
            { names: unsealed.map((row) => row.elitea_title).join(', ') },
          )}
        </Alert>
      ) : null}
    </>
  );
}

function ProviderTable({
  items,
  onEdit,
  onDelete,
}: {
  readonly items: readonly LlmProvider[];
  readonly onEdit: (row: LlmProvider) => void;
  readonly onDelete: (row: LlmProvider) => void;
}): ReactNode {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" data-testid="llm-providers-table">
        <TableHead>
          <TableRow>
            <TableCell>{t('pages.admin.llmProviders.column.status', 'Status')}</TableCell>
            <TableCell>{t('pages.admin.llmProviders.column.name', 'Name')}</TableCell>
            <TableCell>{t('pages.admin.llmProviders.column.provider', 'Provider')}</TableCell>
            <TableCell>{t('pages.admin.llmProviders.column.endpoint', 'Endpoint')}</TableCell>
            <TableCell align="right">
              {t('pages.admin.llmProviders.column.actions', 'Actions')}
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                {/* The words matter. "Inactive" would read as a switch someone
                    turned off; the credential did not RESOLVE, and re-saving it
                    with a corrected endpoint or key is the action. */}
                <Chip
                  size="small"
                  color={row.status_ok ? 'success' : 'warning'}
                  variant="outlined"
                  label={
                    row.status_ok
                      ? t('pages.admin.llmProviders.status.live', 'In use')
                      : t('pages.admin.llmProviders.status.unresolved', 'Not resolving')
                  }
                />
              </TableCell>
              <TableCell>{row.elitea_title}</TableCell>
              <TableCell>{providerTypeLabel(row.type)}</TableCell>
              <TableCell>
                <Typography variant="bodySmall" color="text.secondary">
                  {row.endpoint === '' ? '—' : row.endpoint}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Button size="small" onClick={() => onEdit(row)}>
                  {t('pages.admin.llmProviders.edit', 'Edit')}
                </Button>
                <Button size="small" color="error" onClick={() => onDelete(row)}>
                  {t('pages.admin.llmProviders.delete', 'Delete')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/**
 * The listing's three terminal states: loading, empty, or a table.
 *
 * The empty state is suppressed when the read FAILED, because "no platform
 * providers yet" and "this could not be read" are different facts and the first
 * is the one an operator would act on — by publishing a duplicate of a
 * credential that already exists.
 */
function ProviderResults({
  isPending,
  failed,
  items,
  onEdit,
  onDelete,
}: {
  readonly isPending: boolean;
  readonly failed: boolean;
  readonly items: readonly LlmProvider[];
  readonly onEdit: (row: LlmProvider) => void;
  readonly onDelete: (row: LlmProvider) => void;
}): ReactNode {
  if (isPending) {
    return <LinearProgress aria-label={t('pages.admin.llmProviders.loading', 'Loading providers')} />;
  }
  if (items.length > 0) {
    return <ProviderTable items={items} onEdit={onEdit} onDelete={onDelete} />;
  }
  if (failed) return null;
  return (
    <Typography variant="bodyMedium" color="text.secondary" data-testid="llm-providers-empty">
      {t(
        'pages.admin.llmProviders.empty',
        'No platform providers yet. Until one is published, every project must configure its own provider credentials.',
      )}
    </Typography>
  );
}

/**
 * The delete confirmation, inline rather than in a dialog.
 *
 * The whole of the warning is one sentence, and that sentence IS the reason the
 * confirmation exists: a platform credential is withdrawn from every project at
 * once. Counting the affected projects is not offered because it cannot be
 * cheaply computed — model rows live in one schema per project — and a number
 * this screen invented would be worse than the sentence.
 */
function ConfirmDelete({
  provider,
  onCancel,
  onConfirm,
}: {
  readonly provider: LlmProvider | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: (provider: LlmProvider) => void;
}): ReactNode {
  if (provider === undefined) return null;
  return (
    <Alert
      severity="warning"
      data-testid="llm-providers-confirm-delete"
      action={
        <>
          <Button size="small" onClick={onCancel}>
            {t('pages.admin.llmProviders.cancel', 'Cancel')}
          </Button>
          <Button
            size="small"
            color="error"
            data-testid="llm-providers-confirm-delete-button"
            onClick={() => onConfirm(provider)}
          >
            {t('pages.admin.llmProviders.delete', 'Delete')}
          </Button>
        </>
      }
    >
      {t(
        'pages.admin.llmProviders.confirmDelete',
        'Deleting “{{name}}” withdraws it from every project at once, including any whose models name it. Those models stop resolving.',
        { name: provider.elitea_title },
      )}
    </Alert>
  );
}

export function LlmProxyProvidersPanel(): ReactNode {
  const [editor, setEditor] = useState<{ readonly open: boolean; readonly row: LlmProvider | undefined }>({
    open: false,
    row: undefined,
  });
  const [pendingDelete, setPendingDelete] = useState<LlmProvider | undefined>(undefined);

  const { data, isPending, error } = useAdminLlmProviders();
  const createProvider = useCreateAdminLlmProvider();
  const updateProvider = useUpdateAdminLlmProvider();
  const deleteProvider = useDeleteAdminLlmProvider();

  // Both derived from `data.items`, which is stable between refetches, rather
  // than from a `?? []` fallback that is a fresh array on every render — the
  // dependency that made `useMemo` here recompute unconditionally.
  const items = useMemo(() => data?.items ?? EMPTY_PROVIDERS, [data?.items]);
  const unsealed = useMemo(() => unsealedProviders(items), [items]);

  // The server's own sentence when it gave one — its refusals here name the
  // problem ("not an LLM provider credential type the gateway can dispatch to",
  // a self-referential endpoint), and a generic "failed to save" would discard
  // exactly the words that say what to change.
  const saveFailure = createProvider.error ?? updateProvider.error;
  const saveError =
    saveFailure != null
      ? (configFailureReason(saveFailure) ??
        t('pages.admin.llmProviders.saveError', 'Failed to save the provider.'))
      : undefined;

  const onSubmit = (draft: LlmProviderDraft) => {
    const onSuccess = () => {
      setEditor({ open: false, row: undefined });
    };
    if (editor.row !== undefined) {
      // The TYPE is not resent on an edit: it cannot change (see the dialog),
      // and restating it would make a partial update carry a field the operator
      // did not touch.
      updateProvider.mutate(
        { id: editor.row.id, draft: { elitea_title: draft.elitea_title, data: draft.data } },
        { onSuccess },
      );
      return;
    }
    createProvider.mutate(draft, { onSuccess });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Typography variant="bodySmall" color="text.secondary">
        {t(
          'pages.admin.llmProviders.intro',
          'Provider credentials published here are available to every project on this deployment. A project can still configure its own; both resolve, and a project’s own credential is not replaced by these.',
        )}
      </Typography>

      <SharedScopeWarning publicProjectID={data?.public_project_id ?? 0} />

      <ProviderAlerts
        loadError={error}
        saveError={saveError}
        deleteError={deleteProvider.error}
        unsealed={unsealed}
      />

      <Box sx={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          size="small"
          data-testid="llm-providers-add"
          onClick={() => setEditor({ open: true, row: undefined })}
        >
          {t('pages.admin.llmProviders.add', 'Add a platform provider')}
        </Button>
        {data !== undefined && data.public_project_id > 0 ? (
          // Echoed because getting it wrong is the failure where every
          // credential is published correctly into a schema the gateway never
          // reads, and every other signal on this screen still looks right.
          <Typography variant="bodySmall" color="text.secondary">
            {t('pages.admin.llmProviders.publicProject', 'Shared project: {{id}}', {
              id: data.public_project_id,
            })}
          </Typography>
        ) : null}
      </Box>

      <ProviderResults
        isPending={isPending}
        failed={error != null}
        items={items}
        onEdit={(row) => setEditor({ open: true, row })}
        onDelete={setPendingDelete}
      />

      <ConfirmDelete
        provider={pendingDelete}
        onCancel={() => setPendingDelete(undefined)}
        onConfirm={(row) => {
          deleteProvider.mutate(row.id, { onSuccess: () => setPendingDelete(undefined) });
        }}
      />

      <LlmProviderDialog
        open={editor.open}
        providerTypes={data?.provider_types ?? []}
        editing={editor.row}
        isSaving={createProvider.isPending || updateProvider.isPending}
        serverError={saveError}
        onClose={() => {
          setEditor({ open: false, row: undefined });
          // The previous refusal is DISCARDED on close. Both mutations keep
          // their error until the next mutate(), so without this a failure from
          // one row would still be at the top of the dialog when the operator
          // opened a different one.
          createProvider.reset();
          updateProvider.reset();
        }}
        onSubmit={onSubmit}
      />
    </Box>
  );
}
