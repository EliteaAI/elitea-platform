// `Components<Theme>`'s `MuiDataGrid` key is added by this side-effect-only
// type import (verified against the installed package: the augmentation
// lives at the `themeAugmentation` subpath, not the package root, so it is
// invisible to `Components<Theme>` unless something in the compiled program
// imports it).
import type {} from '@mui/x-data-grid/themeAugmentation';

import type { EliteaComponents } from '../theme-types';

/**
 * `MuiDataGrid` (R-T12). Ported from
 * `apps/elitea-ui/src/components/DataGrid.jsx`'s `eliteaDataGridStyle`.
 *
 * Three deviations from the baseline:
 *  - The baseline gated this on `variant="elitea"`; `DataGridProps` has no
 *    `variant` field at all in `@mui/x-data-grid@9.10.1` (confirmed against
 *    the installed types), and it was the app's only grid skin, so
 *    `styleOverrides.root` (applies unconditionally) replaces the gate.
 *  - The `& .css-tgsonj` rule targeted an Emotion content hash — an
 *    artifact of the baseline's own build, meaningless (and guaranteed to
 *    mismatch) in this app's build, so it is dropped entirely (R-T6; its one
 *    consequence, `borderTop: 0` on the grid's top container, is already
 *    covered by the `.MuiDataGrid-container--top::after` rule below via the
 *    token border colour).
 *  - All `!important`s are dropped per R-T5, including the two the baseline
 *    used on `.MuiDataGrid-row` min-height and `.MuiDataGrid-cell` border:
 *    a plain `styleOverrides.root` selector already out-specifies the
 *    grid's own generated rules for both, and the cell border colour is
 *    additionally reinforced by setting the `--rowBorderColor` custom
 *    property the grid's own CSS reads, so nothing was actually fighting a
 *    higher-specificity rule.
 */
export const MuiDataGrid: EliteaComponents['MuiDataGrid'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      backgroundColor: 'transparent',
        '&.MuiDataGrid-withBorderColor': {
          borderColor: 'transparent',
        },
        '& .MuiDataGrid-container--top [role=row], & .MuiDataGrid-container--bottom [role=row]': {
          background: 'transparent',
        },
        '& .MuiDataGrid-columnHeader--sortable': {
          padding: 0,
        },
        '& .MuiDataGrid-columnHeader:focus, & .MuiDataGrid-columnHeader:focus-within, & .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within':
          {
            outline: 'none',
          },
        '& .MuiDataGrid-cell': {
          display: 'flex',
          alignItems: 'center',
          borderTop: '0',
          borderBottom: `0.0625rem solid ${theme.vars.palette.background.dataGrid.main}`,
        },
        '& .MuiDataGrid-row': {
          // The grid's own cell border reads this custom property
          // (`--DataGrid-rowBorderColor`-style var chain), so the
          // `.MuiDataGrid-cell` rule above does not need `!important` (R-T5)
          // to win the specificity fight the baseline used it for.
          '--rowBorderColor': theme.vars.palette.background.dataGrid.main,
          minHeight: '3.25rem',
        },
        '& .MuiDataGrid-container--top::after': {
          backgroundColor: theme.vars.palette.background.dataGrid.main,
        },
        '& .MuiDataGrid-footerContainer': {
          borderTop: 0,
        },
        '& .MuiDataGrid-iconButtonContainer': {
          display: 'none',
        },
        '& .MuiDataGrid-columnHeader--sortable svg': {
          transition:
            'opacity 200ms cubic-bezier(0.4, 0, 0.2, 1) 0ms, transform 200ms cubic-bezier(0.4, 0, 0.2, 1) 0ms',
        },
        '& .MuiDataGrid-columnHeader--sortable[aria-sort="none"] .MuiSvgIcon-root path': {
          fill: theme.vars.palette.icon.fill.default,
        },
        '& .MuiDataGrid-columnHeader--sortable[aria-sort="ascending"] .MuiSvgIcon-root': {
          transform: 'rotate(180deg)',
        },
        '& .MuiDataGrid-columnHeader--sortable[aria-sort="descending"] .MuiSvgIcon-root': {
          transform: 'rotate(0deg)',
        },
        '& .MuiDataGrid-row--editing .MuiDataGrid-cell': {
          backgroundColor: theme.vars.palette.background.secondary,
        },
        '& .MuiDataGrid-row:hover': {
          backgroundColor: 'transparent',
        },
        '& .MuiDataGrid-editInputCell input': {
          padding: `0 ${theme.spacing(1.25)}`,
        },
        '& .MuiDataGrid-row .MuiInput-root::after, & .MuiDataGrid-row .MuiInput-root::before': {
          display: 'none',
        },
        '& .MuiDataGrid-row .MuiTextField-root textarea': {
          marginBottom: 0,
        },
        '& .MuiDataGrid-overlay': {
          backgroundColor: 'transparent',
        },
      }),
  },
};
