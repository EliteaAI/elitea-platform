import type { EliteaComponents } from '../theme-types';

/**
 * `MuiInputBase` (R-T12). Ported from `EditSecretInputGridTable.tsx`'s
 * `input` style — tightens the input base padding using the theme spacing unit.
 */
export const MuiInputBase: EliteaComponents['MuiInputBase'] = {
  styleOverrides: {
    root: {
      padding: 'var(--el-spacing) calc(var(--el-spacing) * 2)',
    },
  },
};
