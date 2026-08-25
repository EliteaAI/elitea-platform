/**
 * Delete-project confirmation for the admin Projects page.
 *
 * Reference (read-only):
 * `frontends/admin_ui/frontend/src/pages/ProjectsPage/DeleteProjectDialog.jsx`
 * — "Are you sure?" and a red button. This dialog is deliberately heavier, and
 * the reason is what the call actually does.
 *
 * ## What is being destroyed
 *
 * `DELETE /projects/project/administration/{id}` runs the provisioning pipeline
 * in reverse and ends with `DROP SCHEMA p_<id> CASCADE`. That takes every
 * prompt, agent, conversation, artifact, datasource and audit row belonging to
 * the tenant. There is no soft-delete behind it, no retention window and no
 * restore path in the product — recovery means a database backup, if the
 * deployment has one. This is the single most destructive control in the admin
 * panel, and it is the reason the whole surface was withheld until the pipeline
 * existed to run it correctly.
 *
 * So: the names are listed rather than counted, a personal project is called
 * out separately (deleting one strips a real person's own workspace, and the
 * listing's `is_personal` flag is the only thing that distinguishes it from a
 * team project by name), and the operator types the confirmation word. The
 * typing is not ceremony — it is the difference between a mis-click on a red
 * button and an act.
 *
 * ## Partial failure is reported per project
 *
 * There is no batch route: the page deletes one project per request. So "three
 * of five were deleted" is a state that can happen, and it is the only honest
 * report when it does. A dialog that collapsed that into one rejection would
 * leave an operator re-running a delete against projects that are already gone.
 */
import { useCallback, useEffect, useState } from 'react';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import type { AdminProjectRow } from './api/adminProjectsApi';

/**
 * The word the operator types to arm the button.
 *
 * Not localised on purpose: it has to be identical to what the label tells them
 * to type, and a translation that drifted from the prompt would make the
 * control impossible to use rather than merely awkward.
 */
export const DELETE_CONFIRMATION_WORD = 'DELETE';

/** One project's outcome from the per-project delete loop. */
export interface ProjectDeleteFailure {
  readonly projectId: number;
  readonly name: string;
  readonly message: string;
}

export interface AdminProjectDeleteDialogProps {
  readonly open: boolean;
  /** The selected projects, in listing order. Empty ⇒ the dialog is not opened. */
  readonly projects: readonly AdminProjectRow[];
  readonly isDeleting: boolean;
  /** Projects the last attempt could not delete. Empty after a clean run. */
  readonly failures: readonly ProjectDeleteFailure[];
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function AdminProjectDeleteDialog({
  open,
  projects,
  isDeleting,
  failures,
  onClose,
  onConfirm,
}: AdminProjectDeleteDialogProps) {
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    if (open) setConfirmation('');
  }, [open]);

  const armed = confirmation.trim() === DELETE_CONFIRMATION_WORD && !isDeleting;
  const personal = projects.filter((project) => project.is_personal);

  const handleConfirm = useCallback(() => {
    if (!armed) return;
    onConfirm();
  }, [armed, onConfirm]);

  return (
    <Dialog open={open} onClose={isDeleting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {projects.length === 1
          ? t('pages.admin.projects.delete.titleOne', 'Delete project')
          : t('pages.admin.projects.delete.titleMany', 'Delete {{count}} projects', {
              count: projects.length,
            })}
      </DialogTitle>
      <DialogContent>
        <Alert severity="error" sx={{ marginBottom: '1rem' }}>
          <AlertTitle>
            {t('pages.admin.projects.delete.warningTitle', 'This cannot be undone')}
          </AlertTitle>
          {t(
            'pages.admin.projects.delete.warningBody',
            'Deleting a project drops its tenant schema and everything in it — prompts, agents, conversations, artifacts, datasources and audit history — and tears down its object storage, vault secrets and system account. There is no restore.',
          )}
        </Alert>

        <Typography variant="bodyMedium" sx={{ display: 'block', marginBottom: '0.5rem' }}>
          {t('pages.admin.projects.delete.listLabel', 'The following will be destroyed:')}
        </Typography>
        <Box
          component="ul"
          data-testid="admin-projects-delete-list"
          sx={{ margin: 0, marginBottom: '1rem', paddingLeft: '1.25rem' }}
        >
          {projects.map((project) => (
            <Typography key={project.id} component="li" variant="bodyMedium">
              {`${project.name} (ID: ${project.id})`}
            </Typography>
          ))}
        </Box>

        {personal.length > 0 ? (
          <Alert severity="warning" sx={{ marginBottom: '1rem' }}>
            {t(
              'pages.admin.projects.delete.personalWarning',
              '{{count}} of these is a personal project — a single user’s own workspace, not a shared one. Deleting it removes that person’s private prompts and agents.',
              { count: personal.length },
            )}
          </Alert>
        ) : null}

        {failures.length > 0 ? (
          <Alert severity="error" sx={{ marginBottom: '1rem' }}>
            <AlertTitle>
              {t('pages.admin.projects.delete.partialTitle', 'Some projects were not deleted')}
            </AlertTitle>
            <Box component="ul" sx={{ margin: 0, paddingLeft: '1.25rem' }}>
              {failures.map((failure) => (
                <Typography key={failure.projectId} component="li" variant="bodySmall">
                  {`${failure.name}: ${failure.message}`}
                </Typography>
              ))}
            </Box>
          </Alert>
        ) : null}

        <TextField
          fullWidth
          margin="dense"
          value={confirmation}
          disabled={isDeleting}
          onChange={(event) => setConfirmation(event.target.value)}
          label={t(
            'pages.admin.projects.delete.confirmLabel',
            'Type DELETE to confirm',
          )}
          slotProps={{ htmlInput: { 'aria-label': 'Type DELETE to confirm' } }}
        />
      </DialogContent>
      <DialogActions sx={{ paddingX: '1.5rem', paddingBottom: '1rem' }}>
        <Button variant="elitea" color="tertiary" onClick={onClose} disabled={isDeleting}>
          {t('pages.admin.projects.delete.cancel', 'Cancel')}
        </Button>
        <Button color="error" variant="contained" onClick={handleConfirm} disabled={!armed}>
          {isDeleting
            ? t('pages.admin.projects.delete.submitting', 'Deleting…')
            : t('pages.admin.projects.delete.submit', 'Delete permanently')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
