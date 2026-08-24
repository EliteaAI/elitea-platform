/**
 * Admin › Configuration › LLM Proxy — platform **models**.
 *
 * Rendered under the providers on the same tab, because a model names a
 * credential and the most common mistake is a model naming one that is not
 * there. Two screens would put the cause and the effect a click apart.
 *
 * ## Two states the gateway will not fail on, reported here
 *
 *  - `status_ok = false` — the gateway dispatches only `status_ok = true`, so
 *    such a model is stored, listed and never served.
 *  - `credential_resolves = false` — the gateway still ADVERTISES the model and
 *    guesses its provider from a prefix in the model name, saying so only in a
 *    log line on whichever pod loaded it. This screen is the only place an
 *    operator can see it.
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

import { PlatformModelDialog } from './PlatformModelDialog';
import { configFailureReason } from './api/adminConfigurationApi';
import {
  platformModelTypeLabel,
  useAdminPlatformModels,
  useCreatePlatformModel,
  useDeletePlatformModel,
  useUpdatePlatformModel,
  type PlatformModel,
  type PlatformModelDraft,
} from './api/adminLlmPlatformModelsApi';

const EMPTY_MODELS: readonly PlatformModel[] = [];

function ModelRows({
  items,
  onEdit,
  onDelete,
}: {
  readonly items: readonly PlatformModel[];
  readonly onEdit: (row: PlatformModel) => void;
  readonly onDelete: (row: PlatformModel) => void;
}): ReactNode {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" data-testid="platform-models-table">
        <TableHead>
          <TableRow>
            <TableCell>{t('pages.admin.platformModels.column.status', 'Status')}</TableCell>
            <TableCell>{t('pages.admin.platformModels.column.id', 'Model ID')}</TableCell>
            <TableCell>{t('pages.admin.platformModels.column.kind', 'Kind')}</TableCell>
            <TableCell>{t('pages.admin.platformModels.column.wireName', 'Provider model')}</TableCell>
            <TableCell>{t('pages.admin.platformModels.column.provider', 'Provider')}</TableCell>
            <TableCell align="right">
              {t('pages.admin.platformModels.column.actions', 'Actions')}
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Chip
                  size="small"
                  color={row.status_ok ? 'success' : 'warning'}
                  variant="outlined"
                  label={
                    row.status_ok
                      ? t('pages.admin.platformModels.status.live', 'In use')
                      : t('pages.admin.platformModels.status.unresolved', 'Not resolving')
                  }
                />
              </TableCell>
              <TableCell>{row.elitea_title}</TableCell>
              <TableCell>{platformModelTypeLabel(row.type)}</TableCell>
              <TableCell>
                <Typography variant="bodySmall" color="text.secondary">
                  {row.model_name === '' ? '—' : row.model_name}
                </Typography>
              </TableCell>
              <TableCell>
                {row.credential_name === '' ? (
                  <Typography variant="bodySmall" color="text.secondary">
                    {t('pages.admin.platformModels.inferred', 'inferred from the name')}
                  </Typography>
                ) : (
                  <Typography
                    variant="bodySmall"
                    // A link that does not resolve is coloured, because the
                    // gateway serves the model anyway with a guessed provider.
                    color={row.credential_resolves ? 'text.secondary' : 'error'}
                  >
                    {row.credential_name}
                  </Typography>
                )}
              </TableCell>
              <TableCell align="right">
                <Button size="small" onClick={() => onEdit(row)}>
                  {t('pages.admin.platformModels.edit', 'Edit')}
                </Button>
                <Button size="small" color="error" onClick={() => onDelete(row)}>
                  {t('pages.admin.platformModels.delete', 'Delete')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** The listing's three terminal states. */
function ModelResults({
  isPending,
  failed,
  items,
  onEdit,
  onDelete,
}: {
  readonly isPending: boolean;
  readonly failed: boolean;
  readonly items: readonly PlatformModel[];
  readonly onEdit: (row: PlatformModel) => void;
  readonly onDelete: (row: PlatformModel) => void;
}): ReactNode {
  if (isPending) {
    return (
      <LinearProgress aria-label={t('pages.admin.platformModels.loading', 'Loading models')} />
    );
  }
  if (items.length > 0) return <ModelRows items={items} onEdit={onEdit} onDelete={onDelete} />;
  if (failed) return null;
  return (
    <Typography variant="bodyMedium" color="text.secondary" data-testid="platform-models-empty">
      {t(
        'pages.admin.platformModels.empty',
        'No platform models yet. Until one is published, every project must configure its own models.',
      )}
    </Typography>
  );
}

/** The failures this panel can carry at once, each its own statement. */
function ModelAlerts({
  loadError,
  saveError,
  deleteError,
  credentialError,
  unresolved,
}: {
  readonly loadError: unknown;
  readonly saveError: string | undefined;
  readonly deleteError: unknown;
  readonly credentialError: string | undefined;
  readonly unresolved: readonly PlatformModel[];
}): ReactNode {
  return (
    <>
      {loadError != null ? (
        <Alert severity="warning" data-testid="platform-models-load-error">
          {configFailureReason(loadError) ??
            t('pages.admin.platformModels.loadError', 'Failed to load the platform models.')}
        </Alert>
      ) : null}
      {saveError !== undefined ? (
        <Alert severity="error" data-testid="platform-models-save-error">
          {saveError}
        </Alert>
      ) : null}
      {deleteError != null ? (
        <Alert severity="error" data-testid="platform-models-delete-error">
          {configFailureReason(deleteError) ??
            t('pages.admin.platformModels.deleteError', 'Failed to delete the model.')}
        </Alert>
      ) : null}
      {/* Stated, because an empty provider list otherwise reads as "no
          providers are published" — which would send an operator to create a
          duplicate, and would explain every model showing as unresolved. */}
      {credentialError !== undefined ? (
        <Alert severity="warning" data-testid="platform-models-credential-error">
          {credentialError}
        </Alert>
      ) : null}
      {unresolved.length > 0 ? (
        <Alert severity="warning" data-testid="platform-models-unresolved">
          {t(
            'pages.admin.platformModels.unresolved',
            'These models name a provider this platform does not publish. The gateway still offers them and guesses the provider from the model name: {{names}}',
            { names: unresolved.map((row) => row.elitea_title).join(', ') },
          )}
        </Alert>
      ) : null}
    </>
  );
}

export function PlatformModelsPanel(): ReactNode {
  const [editor, setEditor] = useState<{ readonly open: boolean; readonly row: PlatformModel | undefined }>(
    { open: false, row: undefined },
  );
  const { data, isPending, error } = useAdminPlatformModels();
  const createModel = useCreatePlatformModel();
  const updateModel = useUpdatePlatformModel();
  const deleteModel = useDeletePlatformModel();

  const items = useMemo(() => data?.items ?? EMPTY_MODELS, [data?.items]);
  const unresolved = useMemo(() => items.filter((row) => !row.credential_resolves), [items]);

  const saveFailure = createModel.error ?? updateModel.error;
  const saveError =
    saveFailure != null
      ? (configFailureReason(saveFailure) ??
        t('pages.admin.platformModels.saveError', 'Failed to save the model.'))
      : undefined;

  const onSubmit = (draft: PlatformModelDraft) => {
    const onSuccess = () => setEditor({ open: false, row: undefined });
    if (editor.row !== undefined) {
      updateModel.mutate(
        { id: editor.row.id, draft: { elitea_title: draft.elitea_title, data: draft.data } },
        { onSuccess },
      );
      return;
    }
    createModel.mutate(draft, { onSuccess });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Typography variant="bodyMedium" sx={{ fontWeight: 600 }}>
        {t('pages.admin.platformModels.title', 'Platform models')}
      </Typography>
      <Typography variant="bodySmall" color="text.secondary">
        {t(
          'pages.admin.platformModels.intro',
          'Models published here are offered to every project. Each uses a platform provider — a project’s own provider cannot back a platform model, because a published model must resolve the same way for everyone.',
        )}
      </Typography>

      <ModelAlerts
        loadError={error}
        saveError={saveError}
        deleteError={deleteModel.error}
        credentialError={data?.credential_error}
        unresolved={unresolved}
      />

      <Box>
        <Button
          variant="outlined"
          size="small"
          data-testid="platform-models-add"
          onClick={() => setEditor({ open: true, row: undefined })}
        >
          {t('pages.admin.platformModels.add', 'Add a platform model')}
        </Button>
      </Box>

      <ModelResults
        isPending={isPending}
        failed={error != null}
        items={items}
        onEdit={(row) => setEditor({ open: true, row })}
        onDelete={(row) => deleteModel.mutate(row.id)}
      />

      <PlatformModelDialog
        open={editor.open}
        editing={editor.row}
        modelTypes={data?.model_types ?? []}
        credentialNames={data?.credential_names ?? []}
        isSaving={createModel.isPending || updateModel.isPending}
        serverError={saveError}
        onClose={() => {
          setEditor({ open: false, row: undefined });
          createModel.reset();
          updateModel.reset();
        }}
        onSubmit={onSubmit}
      />
    </Box>
  );
}
