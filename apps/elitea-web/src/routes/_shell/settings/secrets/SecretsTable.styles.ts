/**
 * SecretsTable styles — shared between table and row components.
 */
import type { SxProps, Theme } from '@mui/material/styles';

export const tableStyles: Record<string, SxProps<Theme>> = {
  container: {
    flex: 1,
    height: '100%',
    overflow: 'auto',
  },
  actionsContainer: {
    display: 'flex',
    gap: '0.125rem',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  actionButton: {
    padding: '0.375rem',
    minWidth: 0,
  },
  skeletonContainer: {
    padding: '0.5rem',
  },
  skeleton: {
    marginBottom: '0.25rem',
  },
  dataGrid: {
    border: 'none',
    '& .MuiDataGrid-cell': {
      borderBottom: '0.0625rem solid',
      borderColor: 'divider',
    },
    '& .MuiDataGrid-columnHeaders': {
      backgroundColor: 'background.paper',
      borderBottom: '0.0625rem solid',
      borderColor: 'divider',
    },
    '& .MuiDataGrid-row:hover': {
      backgroundColor: 'action.hover',
    },
  },
};
