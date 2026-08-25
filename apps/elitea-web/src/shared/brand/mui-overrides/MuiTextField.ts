import type { EliteaComponents } from '../theme-types';

/**
 * `MuiTextField` (R-T12). Ported from `input/textFieldVariants.js`'s
 * `eliteaTextFieldVariants` (baseline `'standard'` variant). Simplified from
 * the baseline's `underline`-colour-by-state table to the token equivalents;
 * the `Mui-error`/`Mui-disabled`/`Mui-focused` state selectors are preserved
 * verbatim since they are MUI's own state classes, not brand-fork additions.
 *
 * [S1-E follow-up] The `.MuiFormHelperText-root.Mui-error` rule below used
 * `icon.fill.error` for the message TEXT colour. At the time, it was
 * `#D71616` in both colour schemes (`shared/brand/tokens/default.pack.json`),
 * the same non-text-tuned red flagged in `MuiFormHelperText.ts`'s own
 * follow-up comment (3.55:1 against a dark surface, short of WCAG AA's
 * 4.5:1 for text) — a concurrent brand-pack fix has since raised dark-scheme
 * `icon.fill.error` itself to `#ED4F4F` (5.16:1, passing on its own), but
 * `text.warningText` is kept below regardless, for the same
 * established-convention reason `MuiFormHelperText.ts` gives. This selector
 * (`.MuiTextField-root .MuiFormHelperText-root.Mui-error`, 3 classes) wins
 * the cascade over `MuiFormHelperText.ts`'s own `&.Mui-error` override (2
 * classes) for every `MuiTextField`'s helper text specifically — confirmed
 * by rendering a real `variant="standard"` `error` `TextField` and reading
 * `getComputedStyle(...).color` before and after this change, since the two
 * rules' equal-looking class selectors made this a real "which one wins"
 * question, not a guess. Caught by this unit's own Storybook a11y gate
 * (`CommonNumberField`'s `Invalid` story). `icon.fill.error` is left alone
 * on the border-colour rule two lines above — border/UI-component contrast
 * has a looser 3:1 WCAG threshold that value clears either way; only the
 * TEXT use needed the swap to `text.warningText` (the token already
 * established elsewhere in this codebase — `CharacterCounter`/
 * `BannerMessage` — for exactly this failure mode).
 *
 * [T1 follow-up] `.MuiFormLabel-root.Mui-error` had no rule here at all, so
 * MUI's own built-in `FormLabel` default (`&.Mui-error { color:
 * theme.vars.palette.error.main }`) rendered the field label directly —
 * `#D71616` in the dark scheme, 3.55:1 against `background.default`, the
 * exact violation `SecretField`'s `ErrorState` story was waived for
 * (`shared/ui/SecretField/SecretField.stories.tsx`). `error.main` cannot be
 * relightened to fix this without dropping `error.contrastText`'s own
 * 4.5:1 on `MuiAlert`'s filled surface below AA (exhaustive search over the
 * hue-0 ramp, `parity/brand-hue-map.md` §10: best achievable balance is
 * 4.31:1 on both sides, short of 4.5 on both) — it is a fill role paired
 * with `contrastText`, not a text role. Same fix as the `FormHelperText`
 * rule above: point the label at `text.warningText` instead.
 */
export const MuiTextField: EliteaComponents['MuiTextField'] = {
  variants: [
    {
      props: { variant: 'standard' },
      style: ({ theme }) => ({
        padding: `${theme.spacing(1)} 0 0 0`,
        '& .MuiFormLabel-root': {
          color: theme.vars.palette.text.primary,
        },
        '& .MuiFormLabel-root.Mui-disabled': {
          color: theme.vars.palette.text.button.disabled,
        },
        '& .MuiFormLabel-root.Mui-error': {
          color: theme.vars.palette.text.warningText,
        },
        '& input, & textarea': {
          // Baseline `textFieldVariants.js:196-207`. Without the typography
          // spread the input kept MUI's stock 1rem body font while its label
          // used the brand scale, so the control sat a step too large.
          ...theme.typography.labelMedium,
          boxSizing: 'border-box',
          marginBottom: theme.spacing(1),
          color: theme.vars.palette.text.secondary,
        },
        '& input.Mui-disabled, & textarea.Mui-disabled': {
          color: theme.vars.palette.text.default,
          WebkitTextFillColor: theme.vars.palette.text.default,
        },
        '& input::placeholder, & textarea::placeholder': {
          color: theme.vars.palette.text.participant.default,
          opacity: 1,
        },
        '& :not(.Mui-error).MuiInput-underline:before': {
          borderBottomColor: theme.vars.palette.border.lines,
        },
        '& :not(.Mui-error, .Mui-disabled).MuiInput-underline:hover:before': {
          borderBottomColor: theme.vars.palette.border.hover,
        },
        '& :not(.Mui-error) label.Mui-focused': {
          color: theme.vars.palette.primary.main,
        },
        '& :not(.Mui-error).MuiInput-underline.Mui-focused:after': {
          borderBottomColor: theme.vars.palette.primary.main,
        },
        '& .Mui-error.MuiInput-underline:before, & .Mui-error.MuiInput-underline:after': {
          borderBottomColor: theme.vars.palette.icon.fill.error,
        },
        '& .MuiFormHelperText-root.Mui-error': {
          color: theme.vars.palette.text.warningText,
          paddingLeft: theme.spacing(1.5),
        },
        '&:has(.MuiInputBase-root.Mui-disabled), & .MuiInputBase-root.Mui-disabled': {
          cursor: 'not-allowed',
        },
        // Baseline `textFieldVariants.js:130-209` — number fields keep the
        // native spinners without these, which the baseline hides.
        '& input': { height: '1.5rem' },
        '& input[type=number]': { MozAppearance: 'textfield' },
        '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button': {
          WebkitAppearance: 'none',
          margin: 0,
        },
        '& textarea::-webkit-scrollbar': { display: 'none' },
        '& .MuiInput-underline': { padding: `${theme.spacing(0.5)} ${theme.spacing(1.5)} 0` },
      }),
    },
    {
      /**
       * `outlined` — the baseline's `eliteaTextFieldOutlinedStyle()`
       * (`textFieldVariants.js:212-257`, registered at `:356-440`).
       *
       * THE WHOLE VARIANT WAS MISSING. MUI's default `outlined` therefore
       * applied: a 4px radius, a notched outline with a cut-out legend for
       * the floating label, and stock padding — visibly a different control
       * from the product's. The baseline hides the legend and lifts the
       * outline to the top of the box instead, which is why its outlined
       * fields read as plain rounded boxes.
       *
       * Focus is `primary.pressed`, NOT `primary.main` — the baseline
       * distinguishes an input's focus ring from a button's accent.
       *
       * SUBSTITUTION, disclosed: the baseline's hover role is
       * `border.inputHover`, which does not exist in this pack's token
       * vocabulary (`tokens/default.pack.json` has no such id). `border.hover`
       * is used instead — the same role the `standard` variant above already
       * uses for its hover underline, so outlined and standard fields at
       * least agree with each other. If a pack ever states `border.inputHover`,
       * this is the line to revisit.
       */
      props: { variant: 'outlined' },
      style: ({ theme }) => ({
        padding: 0,
        '& .MuiOutlinedInput-root': {
          padding: 0,
          borderRadius: theme.vars.shape.radiusMd,
          '& fieldset': { borderWidth: '0.0625rem', borderColor: theme.vars.palette.border.lines },
          '&:hover fieldset': { borderWidth: '0.0625rem', borderColor: theme.vars.palette.border.hover },
          '&.Mui-focused fieldset': { borderWidth: '0.0625rem', borderColor: theme.vars.palette.primary.pressed },
          '&.Mui-disabled fieldset': { borderColor: theme.vars.palette.border.lines },
          '&.Mui-error fieldset': { borderColor: theme.vars.palette.icon.fill.error },
        },
        '& .MuiOutlinedInput-input': {
          padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
          '&.MuiInputBase-inputMultiline': {
            padding: `${theme.spacing(1)} ${theme.spacing(2)}`,
            maxHeight: '25rem',
            minHeight: '8.25rem',
            overflow: 'auto',
          },
        },
        // The baseline lifts the outline to the top of the box and hides the
        // notch legend, so the label sits ON the border rather than in a gap.
        '& .MuiOutlinedInput-notchedOutline': { top: 0, '& legend': { display: 'none' } },
        '& input, & textarea': { ...theme.typography.labelMedium, boxSizing: 'border-box' },
        '& textarea::-webkit-scrollbar': { display: 'none' },
        '& label.Mui-focused': { color: theme.vars.palette.primary.pressed },
        '& .MuiFormHelperText-root.Mui-error': {
          color: theme.vars.palette.text.warningText,
          paddingLeft: theme.spacing(1.5),
        },
      }),
    },
  ],
};
