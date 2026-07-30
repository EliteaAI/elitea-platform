/**
 * TokensTable styles.
 */
import type { SxProps, Theme } from '@mui/material/styles';

export const tokensTableStyles = (theme: Theme): Record<string, SxProps<Theme>> => ({
  container: {
    borderRadius: 0,
    border: 'none',
    boxShadow: 'none',
  },
  headerCell: {
    fontWeight: 600,
    fontSize: '0.8125rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'text.secondary',
    borderBottom: () => `0.0625rem solid ${theme.palette.border.table}`,
  },
  nameCell: {
    wordBreak: 'break-word',
  },
  loadingContainer: {
    padding: '1.25rem',
  },
  skeleton: {
    height: 40,
    marginBottom: '0.5rem',
    borderRadius: 4,
    backgroundColor: theme.palette.action.disabledBackground,
  },
});
