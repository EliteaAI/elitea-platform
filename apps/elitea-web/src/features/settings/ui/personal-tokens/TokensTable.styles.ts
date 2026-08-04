/**
 * TokensTable styles.
 */
import type { SxProps, Theme } from '@mui/material/styles';

export const tokensTableStyles = (theme: Theme): Record<string, SxProps<Theme>> => ({
  container: {
    borderRadius: 'var(--el-shape-radiusSm, 0px)',
    border: 'none',
    boxShadow: 'none',
  },
  headerCell: {
    fontWeight: 600,
    fontSize: theme.typography.headingSmall.fontSize,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'text.secondary',
    borderBottom: () => `0.0625rem solid ${theme.vars.palette.border.table}`,
  },
  nameCell: {
    wordBreak: 'break-word',
  },
  loadingContainer: {
    padding: '1.25rem',
  },
  emptyContainer: {
    padding: '1.25rem',
    textAlign: 'center',
  },
  skeleton: {
    height: 40,
    marginBottom: '0.5rem',
    borderRadius: 'var(--el-shape-radiusSm, 32px)',
    backgroundColor: theme.vars.palette.action.disabledBackground,
  },
});
