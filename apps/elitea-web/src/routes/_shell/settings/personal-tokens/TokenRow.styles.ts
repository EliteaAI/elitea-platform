/**
 * TokenRow styles — shared between ExpiryCell, ActionsCell, etc.
 */
import type { SxProps, Theme } from '@mui/material/styles';

export const tokenRowStyles = {
  expiry: (): Record<string, SxProps<Theme>> => ({
    container: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: '0.5rem',
    },
    text: {
      width: 'calc(100% - 1.5rem)',
    },
  }),
  actions: (): Record<string, SxProps<Theme>> => ({
    container: {
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: '0.25rem',
    },
    deleteButton: {
      padding: '0.25rem',
    },
  }),
};
