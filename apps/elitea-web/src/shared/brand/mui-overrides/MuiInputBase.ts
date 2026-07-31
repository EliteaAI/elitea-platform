import type { EliteaComponents } from '../theme-types';

/**
 * `MuiInputBase` (R-T12). Ported from `EditSecretInputGridTable.tsx`'s
 * `input` style — tightens the input base padding.
 */
export const MuiInputBase: EliteaComponents['MuiInputBase'] = {
  styleOverrides: {
    root: {
      padding: 'var(--el-spacing-1, 0.25rem) var(--el-spacing-2, 0.5rem)',
    },
  },
};
