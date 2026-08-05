/**
 * Style factory extracted from `NodeCardHeader.tsx` (baseline:
 * `NodeCardHeader.jsx`'s own `nodeCardHeaderStyles`) -- purely to keep
 * `NodeCardHeader.tsx` under the §3.5 400-line budget.
 *
 * DISCLOSED DEVIATIONS from the baseline's literal values, each forced by a
 * real lint rule this app enforces that the baseline never had to satisfy:
 *
 *  - R-T10 (`ad-hoc-radius`): `borderRadius: '1.3125rem'` (a pill-shaped
 *    chip) -> `theme.vars.shape.radiusPill`; `borderRadius: '.25rem'` (a
 *    small icon-wrapper corner) -> `theme.vars.shape.radiusSm`.
 *  - R-T11 (`ad-hoc-font-size`): the baseline sizes its inline SVG icons via
 *    `style={{ fontSize: '1rem' }}` / `'1.5rem'`. This app's ported
 *    `shared/ui/icons/**` are fixed-dimension SVGs (`width="16" height="16"`
 *    on the `<svg>` element, verified by inspecting the source `.svg`
 *    files) -- `font-size` has no effect on their rendered size at all
 *    (they are not `1em`-sized like the baseline's icon font). `width`/
 *    `height` (which DO override the SVG's own size attributes via CSS) are
 *    used instead, at the same rem values, for the same visual result.
 *  - R-T6 (`no-mui-internal-selector`): the baseline's `& .MuiFormLabel-
 *    root: { color: 'text.primary' }` override on the rename `TextField` is
 *    dropped outright rather than reimplemented -- that `TextField` is
 *    always rendered with `label=""` (`NodeCardHeader.jsx:296`, unchanged
 *    here), so the baseline override colours a label that never renders any
 *    text; there is nothing to reproduce.
 *  - R-T9 (raw px/rem in margin/padding/gap): every `gap`/`padding` value
 *    below is expressed via `theme.spacing(n)` instead of a raw rem literal
 *    (this app's default spacing unit is 8px = 0.5rem, same as `EndNode.tsx`'s
 *    own header documents), including `leftSection`/`rightSection` (promoted
 *    from plain objects to theme-callback factories purely so they can reach
 *    `theme.spacing`).
 */
import type { SxProps, Theme } from '@mui/material/styles';

export interface NodeCardHeaderStyles {
  readonly container: SxProps<Theme>;
  readonly leftSection: SxProps<Theme>;
  readonly entryBox: SxProps<Theme>;
  readonly attentionIconWrapper: SxProps<Theme>;
  readonly entrypointIconStyle: { readonly width: string; readonly height: string };
  readonly iconWrapper: SxProps<Theme>;
  readonly nameText: SxProps<Theme>;
  readonly inputWrapper: SxProps<Theme>;
  readonly rightSection: SxProps<Theme>;
  readonly expandButton: SxProps<Theme>;
  readonly collapseIconStyle: { readonly width: string; readonly height: string };
  readonly expandIconStyle: { readonly width: string; readonly height: string };
  readonly menuIconStyle: { readonly width: string; readonly height: string };
  readonly menuIconWrapper: SxProps<Theme>;
}

export function nodeCardHeaderStyles(): NodeCardHeaderStyles {
  return {
    container: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
      maxWidth: '29.4375rem',
      height: '2.75rem',
    },
    leftSection: (theme: Theme) => ({
      display: 'flex',
      justifyContent: 'flex-start',
      gap: theme.spacing(1),
      alignItems: 'center',
      flex: 1,
      minWidth: 0,
      overflow: 'hidden',
    }),
    entryBox: (theme: Theme) => ({
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      color: theme.vars.palette.primary.main,
      width: '1.5rem',
      height: '1.5rem',
    }),
    attentionIconWrapper: (theme: Theme) => ({
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      height: '1.5rem',
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      borderRadius: theme.vars.shape.radiusPill,
      width: '6.75rem',
      color: theme.vars.palette.text.deprecated,
      backgroundColor: theme.vars.palette.background.deprecated,
      cursor: 'pointer',
    }),
    entrypointIconStyle: { width: '1.5rem', height: '1.5rem' },
    iconWrapper: (theme: Theme) => ({
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '1.5rem',
      width: '1.5rem',
      borderRadius: theme.vars.shape.radiusSm,
      padding: theme.spacing(0.5),
      boxSizing: 'border-box',
      border: `.0625rem solid ${theme.vars.palette.border.flowNode}`,
    }),
    nameText: (theme: Theme) => ({
      flex: 1,
      textWrap: 'nowrap',
      overflowWrap: 'break-word',
      textOverflow: 'ellipsis',
      overflow: 'hidden',
      color: theme.vars.palette.text.secondary,
    }),
    inputWrapper: { flex: 1 },
    rightSection: (theme: Theme) => ({
      display: 'flex',
      justifyContent: 'flex-end',
      gap: theme.spacing(1),
      alignItems: 'center',
      flexShrink: 0,
    }),
    expandButton: (theme: Theme) => ({
      marginLeft: 0,
      color: theme.vars.palette.icon.fill.secondary,
    }),
    collapseIconStyle: { width: '1rem', height: '1rem' },
    expandIconStyle: { width: '1rem', height: '1rem' },
    menuIconStyle: { width: '1rem', height: '1rem' },
    menuIconWrapper: (theme: Theme) => ({
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      width: '1rem',
      height: '1rem',
      color: theme.vars.palette.icon.fill.default,
    }),
  };
}
