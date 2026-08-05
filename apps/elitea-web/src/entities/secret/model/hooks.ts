/**
 * Secret-management hook — merged from the old-app trio
 * (`useSecretRowActions` + `useSecretRowUpdate` + `useSecretVisibility`).
 *
 * Exposes a single hook (`useSecretsActions`) that manages:
 *
 *  - Row-mode tracking (TanStack `GridRowModes`)
 *  - Show/hide visibility state per row
 *  - Validation error tracking
 *  - Action-menu anchor state (per row)
 *  - Confirmation-dialog state
 *
 * API mutations are provided as **callbacks** so the page layer can
 * compose them with the specific query-client instance.  This keeps the
 * hook decoupled from TanStack Query's `useMutation` / `invalidateQueries`
 * machinery — the hook owns state, the page owns data fetching.
 */
import { useCallback, useRef, useState } from 'react';

import { GridRowModes } from '@mui/x-data-grid';

import { handleCopy } from '@/shared/lib/clipboard';

import type { Secret } from './types';

/* ── Row representation ────────────────────────────────────────────────── */

export interface SecretRow extends Secret {
  readonly id: string;
  /** Display value — masked by default, plaintext when revealed. */
  secretValue: string;
  readonly isNew: boolean;
}

/* ── Mutation callback types ──────────────────────────────────────────── */

export interface SecretMutations {
  createSecret: (name: string, value: string) => void;
  updateSecret: (oldName: string, name: string, value: string) => void;
  deleteSecret: (name: string) => void;
  hideSecret: (name: string) => void;
  showSecret: (name: string) => Promise<{ value: string; secretName: string }>;
}

/* ── Public API ────────────────────────────────────────────────────────── */

export interface SecretsActionsResult {
  /** Current rows. */
  rows: SecretRow[];
  setRows: React.Dispatch<React.SetStateAction<SecretRow[]>>;

  /** Row-mode model (`GridRowModes` compatible). */
  rowModesModel: Record<string, { mode: string; fieldToFocus?: string; ignoreModifications?: boolean }>;
  setRowModesModel: React.Dispatch<React.SetStateAction<Record<string, { mode: string; fieldToFocus?: string; ignoreModifications?: boolean }>>>;

  /** Visibility map: `rowId → true` means plaintext visible. */
  isShowSecretMap: Record<string, boolean>;
  setIsShowSecretMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;

  /** Validation errors: `"${rowId}-${field}" → boolean`. */
  validationErrors: Record<string, boolean>;

  /** Current anchor element for the open menu (or `null`). */
  anchorEl: HTMLElement | null;
  /** Row id that owns the open menu. */
  anchorRowId: string | null;

  /** Confirmation dialog state. */
  openAlert: string | null;
  openAlertType: 'delete' | 'hide' | '';

  /* ── Handlers ─────────────────────────────────────────────────────── */
  onActionsMenuClick: (rowId: string) => (event: React.MouseEvent) => void;
  onActionsMenuClose: () => void;

  onEdit: (rowId: string) => () => Promise<void>;
  onSave: (rowId: string) => () => Promise<void>;
  onCancel: (rowId: string) => () => void;

  onShowSecret: (rowId: string) => () => Promise<void>;
  onHideSecret: (rowId: string) => void;

  onCopyVisible: (rowId: string) => () => Promise<void>;

  onDelete: (rowId: string) => () => void;
  onHide: (rowId: string) => () => void;
  onCloseAlert: () => () => void;
  onConfirmAlert: (rowId: string) => () => void;

  onValidationChange: (rowId: string, field: string, hasError: boolean) => void;
  isRowInEditMode: (rowId: string) => boolean;
  hasRowValidationErrors: (rowId: string) => boolean;

  /** Mutations — set by the page after hook creation. */
  setMutations: (m: SecretMutations) => void;
}

export function useSecretsActions(): SecretsActionsResult {
  const rowsRef = useRef<SecretRow[]>([]);
  const isShowSecretMapRef = useRef<Record<string, boolean>>({});
  const mutationsRef = useRef<SecretMutations | null>(null);

  const [rows, setRows] = useState<SecretRow[]>([]);
  const [rowModesModel, setRowModesModel] = useState<
    Record<string, { mode: string; fieldToFocus?: string; ignoreModifications?: boolean }>
  >({});
  const [isShowSecretMap, setIsShowSecretMap] = useState<Record<string, boolean>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({});
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [anchorRowId, setAnchorRowId] = useState<string | null>(null);
  const [openAlert, setOpenAlert] = useState<string | null>(null);
  const [openAlertType, setOpenAlertType] = useState<'delete' | 'hide' | ''>('');

  /* Keep refs in sync. */
  rowsRef.current = rows;
  isShowSecretMapRef.current = isShowSecretMap;

  const setMutations = useCallback((m: SecretMutations) => {
    mutationsRef.current = m;
  }, []);

  /* ── Menu ─────────────────────────────────────────────────────────── */
  const onActionsMenuClick = useCallback((rowId: string) => (event: React.MouseEvent) => {
    setAnchorEl(event.currentTarget as HTMLElement);
    setAnchorRowId(rowId);
  }, []);

  const onActionsMenuClose = useCallback(() => {
    setAnchorEl(null);
    setAnchorRowId(null);
  }, []);

  /* ── Validation ───────────────────────────────────────────────────── */
  const onValidationChange = useCallback((rowId: string, field: string, hasError: boolean) => {
    setValidationErrors((prev) => ({ ...prev, [`${rowId}-${field}`]: hasError }));
  }, []);

  const isRowInEditMode = useCallback(
    (rowId: string) => rowModesModel[rowId]?.mode === GridRowModes.Edit,
    [rowModesModel],
  );

  const hasRowValidationErrors = useCallback(
    (rowId: string) => {
      const err = validationErrors[`${rowId}-name`] || validationErrors[`${rowId}-secretValue`];
      return Boolean(err);
    },
    [validationErrors],
  );

  /* ── Edit ─────────────────────────────────────────────────────────── */
  const onEdit = useCallback(
    (rowId: string) => async () => {
      const row = rowsRef.current.find((r) => r.id === rowId);
      if (!row || row.isDefault) return;

      if (!row.name) {
        setRowModesModel((prev) => ({
          ...prev,
          [rowId]: { mode: GridRowModes.Edit, fieldToFocus: 'name' },
        }));
        onActionsMenuClose();
        return;
      }

      const mutations = mutationsRef.current;
      if (!mutations) return;

      try {
        const revealed = await mutations.showSecret(row.name);
        setRows((prev) =>
          prev.map((r) =>
            r.id === rowId ? { ...r, secretValue: revealed.value } : r,
          ),
        );
        if (isShowSecretMapRef.current[rowId]) {
          setIsShowSecretMap((prev) => {
            const next = { ...prev };
            delete next[rowId];
            return next;
          });
        }
      } catch {
        return;
      }

      setRowModesModel((prev) => ({
        ...prev,
        [rowId]: { mode: GridRowModes.Edit, fieldToFocus: 'secretValue' },
      }));
      onActionsMenuClose();
    },
    [onActionsMenuClose],
  );

  /* ── Save ─────────────────────────────────────────────────────────── */
  const onSave = useCallback(
    (rowId: string) => async () => {
      const row = rowsRef.current.find((r) => r.id === rowId);
      if (!row) return;

      const mutations = mutationsRef.current;
      if (!mutations) return;

      if (row.isNew) {
        if (row.name && row.secretValue) {
          mutations.createSecret(row.name, row.secretValue);
        }
        setRows((prev) => prev.filter((r) => r.id !== rowId));
      } else {
        if (row.name && row.secretValue) {
          mutations.updateSecret(row.name, row.name, row.secretValue);
        }
        setRowModesModel((prev) => ({
          ...prev,
          [rowId]: { mode: GridRowModes.View, ignoreModifications: true },
        }));
      }
      return Promise.resolve();
    },
    [],
  );

  /* ── Cancel ───────────────────────────────────────────────────────── */
  const onCancel = useCallback(
    (rowId: string) => () => {
      setRows((prev) => {
        const row = prev.find((r) => r.id === rowId);
        if (!row) return prev;
        if (row.isNew) return prev.filter((r) => r.id !== rowId);
        return prev.map((r) =>
          r.id === rowId ? { ...r, secretValue: r.secretName } : r,
        );
      });

      setRowModesModel((prev) => ({
        ...prev,
        [rowId]: { mode: GridRowModes.View, ignoreModifications: true },
      }));
      onActionsMenuClose();
    },
    [onActionsMenuClose],
  );

  /* ── Copy ─────────────────────────────────────────────────────────── */
  const onCopyVisible = useCallback(
    (rowId: string) => async () => {
      const row = rowsRef.current.find((r) => r.id === rowId);
      if (!row || !isShowSecretMapRef.current[rowId]) return;

      try {
        await handleCopy(row.secretValue);
      } catch {
        // Copy failed — caller provides toast
      }

      // Hide after copy
      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, secretValue: r.secretName } : r)),
      );
      setIsShowSecretMap((prev) => {
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
    },
    [],
  );

  /* ── Show / Hide ──────────────────────────────────────────────────── */
  const onShowSecret = useCallback(
    (rowId: string) => async () => {
      const row = rowsRef.current.find((r) => r.id === rowId);
      if (!row) return;

      const mutations = mutationsRef.current;
      if (!mutations) return;

      try {
        const revealed = await mutations.showSecret(row.name);
        setRows((prev) =>
          prev.map((r) =>
            r.id === rowId ? { ...r, secretValue: revealed.value } : r,
          ),
        );
        setIsShowSecretMap((prev) => ({ ...prev, [rowId]: true }));
      } catch {
        // Error handled by caller
      }
    },
    [],
  );

  const onHideSecret = useCallback(
    (rowId: string) => {
      setRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, secretValue: r.secretName } : r)),
      );
      setIsShowSecretMap((prev) => {
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
    },
    [],
  );

  /* ── Delete / Hide dialogs ────────────────────────────────────────── */
  const onDelete = useCallback(
    (rowId: string) => () => {
      setOpenAlert(rowId);
      setOpenAlertType('delete');
      onActionsMenuClose();
    },
    [onActionsMenuClose],
  );

  const onHide = useCallback(
    (rowId: string) => () => {
      setOpenAlert(rowId);
      setOpenAlertType('hide');
      onActionsMenuClose();
    },
    [onActionsMenuClose],
  );

  const onCloseAlert = useCallback(() => () => {
    setOpenAlert(null);
    setOpenAlertType('');
  }, []);

  const onConfirmAlert = useCallback(
    (rowId: string) => async () => {
      const row = rowsRef.current.find((r) => r.id === rowId);
      if (!row) return;

      const mutations = mutationsRef.current;
      if (!mutations) return;

      if (openAlertType === 'delete') {
        mutations.deleteSecret(row.name);
      } else if (openAlertType === 'hide') {
        mutations.hideSecret(row.name);
      }
      setOpenAlert(null);
      setOpenAlertType('');
      return Promise.resolve();
    },
    [openAlertType],
  );

  return {
    rows,
    setRows,
    rowModesModel,
    setRowModesModel,
    isShowSecretMap,
    setIsShowSecretMap,
    validationErrors,
    anchorEl,
    anchorRowId,
    openAlert,
    openAlertType,
    onActionsMenuClick,
    onActionsMenuClose,
    onEdit,
    onSave,
    onCancel,
    onShowSecret,
    onHideSecret,
    onCopyVisible,
    onDelete,
    onHide,
    onCloseAlert,
    onConfirmAlert,
    onValidationChange,
    isRowInEditMode,
    hasRowValidationErrors,
    setMutations,
  };
}
