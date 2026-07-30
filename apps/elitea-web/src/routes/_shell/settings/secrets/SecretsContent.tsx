/**
 * Secrets settings content — composes `DrawerPageHeader` +
 * `SecretsTable` + data fetching.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/secrets/
 * SecretsContent.jsx`.  This component owns:
 *
 *  - Fetching secrets via `useListSecretsQuery`
 *  - Search filtering
 *  - Creating new secret rows (button + `?createSecret=1` flag)
 *  - Wiring API mutations to the actions hook
 *  - Error toasts on API failures
 *
 * Deviations from the baseline:
 *  - No Redux (sidebar state → dropped)
 *  - No tour IDs
 *  - Uses `DrawerPageHeader` from shared UI
 *  - Uses `useSelectedProjectStore` for project ID
 */
import { memo, useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SecretRow } from '@/entities/secret/model/hooks';
import { useSecretsActions } from '@/entities/secret/model/hooks';
import {
  useListSecretsQuery,
  useCreateSecretMutation,
  useUpdateSecretMutation,
  useDeleteSecretMutation,
  useHideSecretMutation,
  showSecret,
} from '@/entities/secret/api/secretApi';
import { useSelectedProjectStore } from '@/widgets/app-shell';
import { DrawerPageHeader } from '@/shared/ui/settings/DrawerPageHeader';
import { SecretsTable } from '@/routes/_shell/settings/secrets/SecretsTable';
import { t } from '@/shared/ui/lib/t';

export interface SecretsContentProps {
  /** Whether `?createSecret=1` is in the URL. */
  shouldCreate: boolean;
  /** Search query from the header's search input. */
  search: string;
  /** Update the search query. */
  onSearchChange: (value: string) => void;
}

export const SecretsContent = memo(function SecretsContent({
  shouldCreate,
  search,
  onSearchChange,
}: SecretsContentProps) {
  /* ── project context ──────────────────────────────────────────────── */
  const projectId = useSelectedProjectStore((s) => s.project?.id ?? '');

  /* ── API query ────────────────────────────────────────────────────── */
  const { data: secrets = [], isFetching } = useListSecretsQuery(projectId, {
    enabled: !!projectId,
  });

  /* ── API mutations ────────────────────────────────────────────────── */
  const createMutation = useCreateSecretMutation(projectId);
  const updateMutation = useUpdateSecretMutation(projectId);
  const deleteMutation = useDeleteSecretMutation(projectId);
  const hideMutation = useHideSecretMutation(projectId);

  /* ── local rows state ─────────────────────────────────────────────── */
  const [rows, setRows] = useState<SecretRow[]>([]);

  // Sync API data into local rows (preserve temporary new-secret rows)
  useEffect(() => {
    if (!isFetching) {
      setRows((prev) => {
        const newRows = prev.filter((r) => r.isNew);
        const mapped: SecretRow[] = secrets.map((s) => ({
          id: `existing-${s.name}`,
          name: s.name,
          secretName: s.secretName,
          isDefault: s.isDefault,
          secretValue: s.secretName,
          isNew: false,
        }));
        return [...newRows, ...mapped];
      });
    }
  }, [secrets, isFetching]);

  // Handle ?createSecret=1 URL flag
  useEffect(() => {
    if (shouldCreate && projectId) {
      const id = `new-${Date.now()}`;
      const newRow: SecretRow = {
        id,
        name: '',
        secretName: '',
        isDefault: false,
        secretValue: '',
        isNew: true,
      };
      setRows((prev) => [newRow, ...prev]);
    }
  }, [shouldCreate, projectId]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => r.name.toLowerCase().includes(needle));
  }, [rows, search]);

  /* ── actions hook ─────────────────────────────────────────────────── */
  const actions = useSecretsActions();

  // Wire mutations to the hook
  const setMutations = actions.setMutations;

  // Memoize the mutations wrapper so the hook doesn't get a new ref every render
  const mutationsWrapper = useMemo(
    () => ({
      createSecret: (name: string, value: string) => {
        createMutation.mutate({ name, value });
      },
      updateSecret: (oldName: string, name: string, value: string) => {
        updateMutation.mutate({ name: oldName, params: { name, value } });
      },
      deleteSecret: (name: string) => {
        deleteMutation.mutate(name);
      },
      hideSecret: (name: string) => {
        hideMutation.mutate(name);
      },
      showSecret: (name: string) => showSecret(projectId, name),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, createMutation.mutate, updateMutation.mutate, deleteMutation.mutate, hideMutation.mutate],
  );

  useEffect(() => {
    setMutations(mutationsWrapper);
  }, [setMutations, mutationsWrapper]);

  /* ── styles ───────────────────────────────────────────────────────── */
  const styles = getStyles();

  return (
    <Paper elevation={0} sx={styles.root}>
      <DrawerPageHeader
        title={t('entities.secret.pageTitle', 'Secrets')}
        showSearchInput
        showAddButton
        slotProps={{
          searchInput: {
            search,
            onChangeSearch: onSearchChange,
            placeholder: t('entities.secret.searchPlaceholder', 'Search secrets'),
          },
          addButton: {
            onAdd: () => {
              const id = `new-${Date.now()}`;
              const newRow: SecretRow = {
                id,
                name: '',
                secretName: '',
                isDefault: false,
                secretValue: '',
                isNew: true,
              };
              setRows((prev) => [newRow, ...prev]);
            },
            disabled: isFetching,
            tooltip: t('entities.secret.addTooltip', 'Create new secret'),
          },
        }}
      />
      <Box sx={styles.content}>
        <SecretsTable
          rows={filteredRows}
          setRows={setRows}
          rowModesModel={actions.rowModesModel}
          setRowModesModel={actions.setRowModesModel}
          isFetching={isFetching}
          isShowSecretMap={actions.isShowSecretMap}
          validationErrors={actions.validationErrors}
          onValidationChange={actions.onValidationChange}
          actions={{
            onSave: actions.onSave,
            onCancel: actions.onCancel,
            onShowSecret: actions.onShowSecret,
            onHideSecret: actions.onHideSecret,
            onCloseAlert: actions.onCloseAlert,
            onConfirmAlert: actions.onConfirmAlert,
          }}
          menu={{
            anchorEl: actions.anchorEl,
            anchorRowId: actions.anchorRowId,
            onCloseMenu: actions.onActionsMenuClose,
          }}
          dialog={{
            openAlert: actions.openAlert,
            openAlertType: actions.openAlertType,
          }}
        />
      </Box>
    </Paper>
  );
});

const getStyles = (): Record<string, SxProps<Theme>> => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    borderRadius: 0,
  },
  content: {
    flex: 1,
    minHeight: 0,
    padding: '0 1.5rem 1.5rem',
  },
});
