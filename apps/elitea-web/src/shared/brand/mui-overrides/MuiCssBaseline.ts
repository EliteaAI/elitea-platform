import type { EliteaComponents } from '../theme-types';

/**
 * `MuiCssBaseline` (R-T12). Ported verbatim from `MainTheme.js:188-208`: the
 * app hides the native scrollbar chrome (every scroll surface that needs a
 * visible thumb uses `ScrollableContainer`'s SimpleBar instead) and disables
 * the text caret outside actual inputs.
 */
export const MuiCssBaseline: EliteaComponents['MuiCssBaseline'] = {
  styleOverrides: {
    '*': {
      scrollbarWidth: 'none',
    },
    body: {
      caretColor: 'transparent',
      height: '100%',
      '::-webkit-scrollbar': {
        display: 'none',
      },
      msOverflowStyle: 'none',
    },
    input: {
      caretColor: 'auto',
    },
    textarea: {
      caretColor: 'auto',
    },
  },
};
