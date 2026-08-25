/**
 * The Providers panel's presentational parts: its alert stack, its table, its
 * three terminal states and its delete confirmation.
 *
 * Their own file so `./LlmProxyProvidersPanel.tsx` stays the panel's STATE —
 * what is being edited, what failed, what is pending — and these stay markup
 * with one decision each. The split was forced by the file-length gate and is
 * the right seam regardless: every function here is pure in its props.
 */
import type { ReactNode } from 'react';

import Alert from '@mui/material/Alert';
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

import { providerTypeLabel } from './llmProviderForm';
import { configFailureReason } from './api/adminConfigurationApi';
import type { LlmProvider } from './api/adminLlmProvidersApi';

/**
 * The four things that can be wrong at once, each its own statement.
 *
 * Extracted so the panel stays its own state machine rather than a stack of
 * conditionals — the same complexity-gate split `AdminLlmProxyEditor` made for
 * `ModelCatalogueAlerts`, for the same reason.
 */
export function ProviderAlerts({
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

export function ProviderTable({
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
                <Button
            variant="elitea" color="tertiary" size="small" onClick={() => onEdit(row)}>
                  {t('pages.admin.llmProviders.edit', 'Edit')}
                </Button>
                <Button
            variant="elitea" color="alarm" size="small" onClick={() => onDelete(row)}>
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
export function ProviderResults({
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
export function ConfirmDelete({
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
          <Button
            variant="elitea" color="tertiary" size="small" onClick={onCancel}>
            {t('pages.admin.llmProviders.cancel', 'Cancel')}
          </Button>
          <Button
            variant="elitea" color="alarm"
            size="small"
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

