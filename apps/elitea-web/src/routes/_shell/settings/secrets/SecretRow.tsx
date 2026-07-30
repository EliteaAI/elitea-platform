/**
 * SecretRow — renders a single secret row inside the DataGrid.
 *
 * Handles edit mode inline editing (via `EditSecretInputGridTable`) and
 * view-mode cells (value visibility toggle + actions menu).
 */
import { memo, useCallback } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import DotsMenuIcon from '@mui/icons-material/MoreHoriz';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';

import type { GridRenderCellParams } from '@mui/x-data-grid';
import { GridRowModes } from '@mui/x-data-grid';

import type { SecretRow } from '@/entities/secret/model/hooks';
import { t } from '@/shared/ui/lib/t';
import { EditSecretInputGridTable } from './EditSecretInputGridTable';
import { SecretValueCell } from './SecretValueCell';
import { tableStyles } from './SecretsTable.styles';

/* ── props ─────────────────────────────────────────────────────────────── */

export interface SecretRowProps {
  row: SecretRow;
  params: GridRenderCellParams;
  rowModesModel: Record<string, { mode: string; fieldToFocus?: string; ignoreModifications?: boolean }>;
  validationErrors: Record<string, boolean>;
  isShowSecretMap: Record<string, boolean>;
  setRows: React.Dispatch<React.SetStateAction<SecretRow[]>>;
  setRowModesModel: React.Dispatch<React.SetStateAction<Record<string, { mode: string; fieldToFocus?: string; ignoreModifications?: boolean }>>>;
  onValidationChange: (rowId: string, field: string, hasError: boolean) => void;
  actions: {
    onSave: (rowId: string) => () => Promise<void>;
    onCancel: (rowId: string) => () => void;
    onShowSecret: (rowId: string) => () => Promise<void>;
    onHideSecret: (rowId: string) => void;
  };
}

/* ── component ─────────────────────────────────────────────────────────── */

export const SecretRowComponent = memo(function SecretRowComponent({
  row,
  params,
  rowModesModel,
  validationErrors,
  isShowSecretMap,
  setRows,
  setRowModesModel,
  onValidationChange,
  actions,
}: SecretRowProps) {
  const styles = tableStyles;
  const isEditing = rowModesModel[row.id]?.mode === GridRowModes.Edit;
  const hasValidationErrors = validationErrors[`${row.id}-name`] || validationErrors[`${row.id}-secretValue`];
  const isVisible = !!isShowSecretMap[row.id];

  /* ── name cell ─────────────────────────────────────────────────────── */

  const renderNameCell = useCallback(() => {
    if (isEditing && row.isNew) {
      return (
        <EditSecretInputGridTable
          id={row.id}
          field="name"
          value={String(params.value)}
          row={row}
          onChange={(editId, _field, newValue) => {
            setRows((prev) => prev.map((r) => (r.id === editId ? { ...r, name: newValue } : r)));
          }}
          onExitEditMode={(editId) => {
            setRowModesModel((prev) => ({ ...prev, [editId]: { mode: GridRowModes.View } }));
          }}
          onValidationChange={onValidationChange}
        />
      );
    }
    return valueViewCell(params);
  }, [isEditing, row, params.value, setRows, setRowModesModel, onValidationChange, params]);

  /* ── value cell ────────────────────────────────────────────────────── */

  const renderValueCell = useCallback(() => {
    const isValueEditing = isEditing && !row.isNew;
    if (isValueEditing) {
      return (
        <EditSecretInputGridTable
          id={row.id}
          field="secretValue"
          value={String(params.value)}
          row={row}
          onChange={(editId, _field, newValue) => {
            setRows((prev) => prev.map((r) => (r.id === editId ? { ...r, secretValue: newValue } : r)));
          }}
          onExitEditMode={(editId) => {
            setRowModesModel((prev) => ({ ...prev, [editId]: { mode: GridRowModes.View } }));
          }}
          onValidationChange={onValidationChange}
        />
      );
    }
    return (
      <SecretValueCell
        label={row.secretName}
        value={row.secretValue}
        isVisible={isVisible}
        onCopy={async () => {}}
        onToggleVisibility={() => {
          if (isVisible) {
            actions.onHideSecret(row.id);
          } else {
            void actions.onShowSecret(row.id)();
          }
        }}
      />
    );
  }, [isEditing, row, params.value, isShowSecretMap, onValidationChange, actions.onHideSecret, actions.onShowSecret]);

  /* ── actions cell ──────────────────────────────────────────────────── */

  const renderActionsCell = useCallback(() => {
    if (isEditing) {
      return (
        <Box sx={styles.actionsContainer}>
          <IconButton
            size="small"
            color="primary"
            onClick={() => void actions.onSave(row.id)()}
            disabled={hasValidationErrors}
            sx={styles.actionButton}
            aria-label={t('entities.secret.actions.save', 'Save')}
          >
            <CheckIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color="primary"
            onClick={() => actions.onCancel(row.id)()}
            sx={styles.actionButton}
            aria-label={t('entities.secret.actions.cancel', 'Cancel')}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      );
    }

    return (
      <Box sx={styles.actionsContainer}>
        {!row.isNew && (
          <IconButton
            size="small"
            color="tertiary"
            onClick={() => {
              if (isVisible) {
                actions.onHideSecret(row.id);
              } else {
                void actions.onShowSecret(row.id)();
              }
            }}
            disabled={row.isDefault}
            sx={styles.actionButton}
            aria-label={isVisible ? t('entities.secret.actions.hide', 'Hide') : t('entities.secret.actions.show', 'Show')}
          >
            {isVisible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
          </IconButton>
        )}
        <IconButton
          size="small"
          color="tertiary"
          onClick={(e) => {
            e.stopPropagation();
          }}
          sx={styles.actionButton}
          aria-label={t('entities.secret.actions.moreActions', 'More actions')}
        >
          <DotsMenuIcon fontSize="small" />
        </IconButton>
      </Box>
    );
  }, [isEditing, row, hasValidationErrors, styles, actions, isVisible]);

  return (
    <>
      {renderNameCell()}
      {renderValueCell()}
      {renderActionsCell()}
    </>
  );
});

/* ── static cell renderers ─────────────────────────────────────────────── */

function valueViewCell(params: GridRenderCellParams): React.ReactNode {
  const value = String(params.value ?? '');
  return value ? (
    <Typography variant="bodyMedium" noWrap>
      {value}
    </Typography>
  ) : (
    <Typography variant="bodyMedium" color="text.disabled">-</Typography>
  );
}
