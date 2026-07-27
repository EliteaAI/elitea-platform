import type { EliteaComponents } from '../theme-types';

/**
 * `MuiCheckbox` (R-T12). Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/checkbox/BaseCheckbox.jsx`'s
 * `eliteaCheckboxVariants`. The custom checked/empty/indeterminate icons
 * (`shared/ui/BaseCheckbox`) are plain `<path>` outlines, so the checked
 * mark itself is painted via `stroke`, not `fill`.
 *
 * Deviation from the baseline: the baseline gated this on `variant="elitea"`
 * — but `Checkbox` has no typed `variant` prop in MUI 9.2 (`variant` is not
 * one of the ~20 components with a `PropsVariantOverrides` augmentation
 * point; confirmed against the installed `Checkbox.d.ts`), and it was the
 * app's only checkbox skin regardless, so `styleOverrides.root` (applies
 * unconditionally) replaces the variant gate with no behavioural change.
 */
export const MuiCheckbox: EliteaComponents['MuiCheckbox'] = {
  styleOverrides: {
    root: ({ theme }) => {
      const { palette } = theme.vars;
      return {
        // Icon size, not text: `width`/`height` (not `fontSize`, R-T11 —
        // that rule targets text sizing; SvgIcon's font-size-driven `1em`
        // default is overridden the same visual way via explicit box size).
        '& .MuiSvgIcon-root': {
          width: '1rem',
          height: '1rem',
        },
        '&&:not(.Mui-checked):not(.MuiCheckbox-indeterminate) .MuiSvgIcon-root': {
          color: palette.checkbox.default,
          fill: 'none',
        },
        '&&.Mui-checked .MuiSvgIcon-root': {
          color: palette.checkbox.active,
        },
        '&&.Mui-checked .MuiSvgIcon-root path, &&.MuiCheckbox-indeterminate .MuiSvgIcon-root path': {
          fill: 'none',
          stroke: palette.checkbox.mark,
        },
        '&&.MuiCheckbox-indeterminate .MuiSvgIcon-root': {
          color: palette.checkbox.active,
        },
        '&&:hover:not(.Mui-disabled)': {
          backgroundColor: 'transparent',
          '&:not(.Mui-checked):not(.MuiCheckbox-indeterminate) .MuiSvgIcon-root': {
            color: palette.checkbox.hover.off,
            fill: 'none',
          },
          '&.Mui-checked .MuiSvgIcon-root, &.MuiCheckbox-indeterminate .MuiSvgIcon-root': {
            color: palette.checkbox.hover.on,
          },
          '&.Mui-checked .MuiSvgIcon-root path, &.MuiCheckbox-indeterminate .MuiSvgIcon-root path': {
            fill: 'none',
            stroke: palette.checkbox.mark,
          },
        },
        '&&.Mui-focusVisible': {
          backgroundColor: 'transparent',
        },
        '&&.Mui-disabled': {
          '&:not(.Mui-checked):not(.MuiCheckbox-indeterminate) .MuiSvgIcon-root, &.Mui-checked .MuiSvgIcon-root, &.MuiCheckbox-indeterminate .MuiSvgIcon-root':
            {
              color: palette.checkbox.disabled,
              fill: 'none',
            },
          '&.Mui-checked .MuiSvgIcon-root path, &.MuiCheckbox-indeterminate .MuiSvgIcon-root path': {
            fill: 'none',
            stroke: palette.checkbox.mark,
          },
        },
      };
    },
  },
  variants: [
    {
      props: { size: 'xs' },
      style: { padding: '0.25rem', '& .MuiSvgIcon-root': { width: '0.75rem', height: '0.75rem' } },
    },
    {
      props: { size: 'small' },
      style: { padding: '0.375rem', '& .MuiSvgIcon-root': { width: '0.875rem', height: '0.875rem' } },
    },
    {
      props: { size: 'medium' },
      style: { padding: '0.5rem', '& .MuiSvgIcon-root': { width: '1rem', height: '1rem' } },
    },
    {
      props: { size: 'large' },
      style: { padding: '0.625rem', '& .MuiSvgIcon-root': { width: '1.25rem', height: '1.25rem' } },
    },
    {
      props: { size: 'xl' },
      style: { padding: '0.75rem', '& .MuiSvgIcon-root': { width: '1.5rem', height: '1.5rem' } },
    },
  ],
};
