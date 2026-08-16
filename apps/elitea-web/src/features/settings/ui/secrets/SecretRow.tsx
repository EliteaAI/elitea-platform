/**
 * SecretRow — renders a single secret row inside the DataGrid.
 *
 * Handles edit mode inline editing (via `EditSecretInputGridTable`) and
 * view-mode cells (value visibility toggle + actions menu).
 *
 * The DataGrid calls `renderCell` once per column/row pair — this
 * component is wired to ALL THREE columns (`name` / `secretValue` /
 * `actions`, see `SecretsTable.tsx`'s `columnsWithCell`) and renders only
 * the slice of content matching `params.field`, so each column gets its
 * own cell content instead of everything being crammed into one column.
 */
import { memo, useCallback, useMemo } from 'react';

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

import type { SecretRow } from '@/entities/secret';
import { t } from '@/shared/i18n';
import { EditSecretInputGridTable } from './EditSecretInputGridTable';
import { SecretValueCell } from './SecretValueCell';
import type { SecretPermissions } from './SecretsTable';
import { tableStyles } from './SecretsTable.styles';

/* ── props ─────────────────────────────────────────────────────────────── */

export interface SecretRowProps {
  row: SecretRow;
  params: GridRenderCellParams;
  rowModesModel: Record<string, { mode: string; fieldToFocus?: string; ignoreModifications?: boolean }>;
  validationErrors: Record<string, boolean>;
  isShowSecretMap: Record<string, boolean>;
  /** What the caller may do. Every control in this row is gated on it (#402). */
  permissions: SecretPermissions;
  setRows: React.Dispatch<React.SetStateAction<SecretRow[]>>;
  setRowModesModel: React.Dispatch<React.SetStateAction<Record<string, { mode: string; fieldToFocus?: string; ignoreModifications?: boolean }>>>;
  onValidationChange: (rowId: string, field: string, hasError: boolean) => void;
  actions: {
    onSave: (rowId: string) => () => Promise<void>;
    onCancel: (rowId: string) => () => void;
    onShowSecret: (rowId: string) => () => Promise<void>;
    onHideSecret: (rowId: string) => void;
    onCopySecretValue: (rowId: string) => () => Promise<void>;
    onActionsMenuClick: (rowId: string) => (event: React.MouseEvent) => void;
  };
}

/* ── component ─────────────────────────────────────────────────────────── */

export const SecretRowComponent = memo(function SecretRowComponent({
  row,
  params,
  rowModesModel,
  validationErrors,
  isShowSecretMap,
  permissions,
  setRows,
  setRowModesModel,
  onValidationChange,
  actions,
}: SecretRowProps) {
  const styles = tableStyles;
  const isEditing = rowModesModel[row.id]?.mode === GridRowModes.Edit;
  const hasValidationErrors = validationErrors[`${row.id}-name`] || validationErrors[`${row.id}-secretValue`];
  const isVisible = !!isShowSecretMap[row.id];
  // The menu opens on three items and each is gated (#402). With none of them
  // available the button would open an empty menu, so it is not rendered.
  // `.edit` needs `.unsecret` too, for the reason SecretActionsMenu records.
  const hasRowActions =
    (permissions.canEdit && permissions.canUnsecret) || permissions.canHide || permissions.canDelete;
  /** Bundled so the cell-render callbacks below stay within the §3.5 hook-deps budget — these two state setters are always used as a pair. */
  const rowMutators = useMemo(() => ({ setRows, setRowModesModel }), [setRows, setRowModesModel]);

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
            rowMutators.setRows((prev) => prev.map((r) => (r.id === editId ? { ...r, name: newValue } : r)));
          }}
          onExitEditMode={(editId) => {
            rowMutators.setRowModesModel((prev) => ({ ...prev, [editId]: { mode: GridRowModes.View } }));
          }}
          onValidationChange={onValidationChange}
        />
      );
    }
    return valueViewCell(params);
  }, [isEditing, row, rowMutators, onValidationChange, params]);

  /* ── value cell ────────────────────────────────────────────────────── */

  const renderValueCell = useCallback(() => {
    // Editable for BOTH cases of edit mode. A prior `isEditing && !row.isNew`
    // left a brand-new row's value cell on the read-only `SecretValueCell`,
    // so a new secret's value could never be typed; `onSave`'s
    // `if (row.name && row.secretValue)` guard (entities/secret/model/
    // hooks.ts) then never held and `createSecret` was never called, the row
    // being dropped from state silently (#137).
    const isValueEditing = isEditing;
    if (isValueEditing) {
      return (
        <EditSecretInputGridTable
          id={row.id}
          field="secretValue"
          value={String(params.value)}
          row={row}
          onChange={(editId, _field, newValue) => {
            rowMutators.setRows((prev) => prev.map((r) => (r.id === editId ? { ...r, secretValue: newValue } : r)));
          }}
          onExitEditMode={(editId) => {
            rowMutators.setRowModesModel((prev) => ({ ...prev, [editId]: { mode: GridRowModes.View } }));
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
        canToggleVisibility={permissions.canUnsecret}
        canCopy={permissions.canUnsecret}
        onCopy={async () => {
          await actions.onCopySecretValue(row.id)();
        }}
        onToggleVisibility={() => {
          if (isVisible) {
            actions.onHideSecret(row.id);
          } else {
            void actions.onShowSecret(row.id)();
          }
        }}
      />
    );
  }, [isEditing, row, params.value, onValidationChange, actions, isVisible, permissions, rowMutators]);

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
        {!row.isNew && permissions.canUnsecret && (
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
        {hasRowActions && (
          <IconButton
            size="small"
            color="tertiary"
            onClick={(e) => {
              e.stopPropagation();
              actions.onActionsMenuClick(row.id)(e);
            }}
            sx={styles.actionButton}
            aria-label={t('entities.secret.actions.moreActions', 'More actions')}
          >
            <DotsMenuIcon fontSize="small" />
          </IconButton>
        )}
      </Box>
    );
  }, [isEditing, row, hasValidationErrors, styles, actions, isVisible, permissions, hasRowActions]);

  /* ── field-scoped render ──────────────────────────────────────────── */

  switch (params.field) {
    case 'name':
      return <>{renderNameCell()}</>;
    case 'secretValue':
      return <>{renderValueCell()}</>;
    case 'actions':
      return <>{renderActionsCell()}</>;
    default:
      return null;
  }
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
