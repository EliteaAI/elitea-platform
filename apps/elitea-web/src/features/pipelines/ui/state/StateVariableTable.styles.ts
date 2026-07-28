/**
 * Style values for `./StateVariableTable.tsx`, split out purely to keep
 * that file under the §3.5 400-line budget (same split rationale as
 * `./RunStateDialog.styles.ts`). `gridClasses` computed keys, not literal
 * `.MuiDataGrid-*` strings — see that file's own doc comment for the
 * `no-mui-internal-selector` (R-T6) rationale, identical here.
 */
import type { SxProps, Theme } from '@mui/material/styles';
import { gridClasses } from '@mui/x-data-grid';

export const valueCellSx: SxProps<Theme> = { whiteSpaceCollapse: 'preserve' };

export const deleteButtonSx: SxProps<Theme> = { marginLeft: 0 };

export const gridWrapperSx: SxProps<Theme> = (theme: Theme) => ({
  width: '100%',
  '& .actions': {
    color: theme.vars.palette.text.secondary,
    justifyContent: 'center',
  },
  '& .textPrimary': {
    color: theme.vars.palette.text.secondary,
  },
  [`& .${gridClasses.cell}.error`]: {
    borderBottom: `.0625rem solid ${theme.vars.palette.border.error}`,
  },
});

export const gridSx: SxProps<Theme> = (theme: Theme) => ({
  [`& .${gridClasses.columnHeader}`]: {
    paddingInline: theme.spacing(1.25),
  },
  [`& .${gridClasses.cell}`]: {
    [`&.${gridClasses['cell--editing']}:focus-within`]: {
      outline: 'none',
    },
    [`&.${gridClasses['cell--editing']}`]: {
      backgroundColor: 'transparent',
      borderBottom: `.0625rem solid ${theme.vars.palette.primary.main}`,
    },
  },
});
