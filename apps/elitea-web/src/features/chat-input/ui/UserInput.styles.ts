import type { Theme } from '@mui/material/styles';

/**
 * Style factory for `UserInput.tsx`, split out to keep that file under the
 * §3.5 file-length/complexity budgets. Ported from `UserInput.jsx`'s own
 * `userInputStyles`, with brand-token substitutions — see each function's
 * own comment for the specific R-T1/R-T2/R-T9/R-T10/R-T11 deviation.
 */

export const stopIconStyle = { width: '1rem', height: '1rem' };

/**
 * `getInputBackground`'s baseline (`UserInput.jsx`) branched on
 * `palette.mode === 'light'` to pick the *focused* background — banned
 * outright here (R-T2: no `palette.mode` branching) and unnecessary: the
 * brand tokens already carry a matched, scheme-independent
 * `userInputBackground`/`userInputBackgroundActive` pair purpose-built for
 * exactly this component (`palette.augment.d.ts`), so the not-focused/
 * focused-or-recording split reduces to picking between those two tokens —
 * no JS mode branch, no `background.card.default` mismatch with the
 * baseline's own two-tier (default vs light/dark-focused) shape.
 */
export function userInputStyles(isFocused: boolean, isDragOver: boolean, isRecording: boolean) {
  const getInputBackground = (theme: Theme): string =>
    isFocused || isRecording
      ? theme.vars.palette.background.userInputBackgroundActive
      : theme.vars.palette.background.userInputBackground;

  const getInputBorder = (theme: Theme): string => {
    if (isRecording) return theme.vars.palette.primary.main;
    if (!isFocused) return 'transparent';
    return `linear-gradient(0deg, ${theme.vars.palette.background.userInputBorderDark} 0%, ${theme.vars.palette.background.userInputBorderLight} 100%)`;
  };

  return {
    gradientBorder: (theme: Theme) => ({
      width: '100%',
      padding: '0.0625rem',
      borderRadius: theme.vars.shape.radiusLg,
      background: getInputBorder(theme),
      ...((isFocused || isRecording) && {
        boxShadow: isRecording
          ? `0 0 0.75rem 0 ${theme.vars.palette.primary.main}40`
          : `0 -0.3125rem 1.25rem 0 ${theme.vars.palette.background.userInputBorderShadow}`,
      }),
    }),
    container: (theme: Theme) => ({
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      padding: '.75rem 1rem',
      alignItems: 'flex-start',
      borderRadius: theme.vars.shape.radiusLg,
      background: isDragOver ? `${theme.vars.palette.primary.main}15` : getInputBackground(theme),
      border: isDragOver
        ? `0.125rem dashed ${theme.vars.palette.primary.main}`
        : `0.0625rem solid ${isFocused || isRecording ? 'transparent' : theme.vars.palette.border.lines}`,
      boxSizing: 'border-box',
      gap: '1.5rem',
      transition: 'all 0.2s ease-in-out',
      position: 'relative',
      ...(isDragOver && { boxShadow: `0 0.25rem 0.75rem ${theme.vars.palette.primary.main}30` }),
    }),
    textFieldWrapper: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      position: 'relative',
    },
    mirrorDiv: {
      position: 'absolute',
      inset: 0,
      overflow: 'auto',
      pointerEvents: 'none',
      zIndex: 0,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      padding: 0,
      fontStyle: 'normal',
      fontWeight: 500,
      lineHeight: '1.5rem',
      fontFamily: 'inherit',
      '&::-webkit-scrollbar': { display: 'none' },
      scrollbarWidth: 'none',
    },
    textField: {
      padding: 0,
      flex: '1 0 0',
      fontStyle: 'normal',
      fontWeight: 500,
      lineHeight: '1.5rem',
      position: 'relative',
      zIndex: 1,
      '&::-webkit-scrollbar': { display: 'none' },
      scrollbarWidth: 'none',
      '& textarea': { marginBottom: 0, '&::-webkit-scrollbar': { display: 'none' } },
    },
    textFieldInput: (color: string | undefined) => (theme: Theme) => ({
      color: color ?? theme.vars.palette.text.secondary,
      padding: 0,
    }),
    transparentCaretText: (color: string | undefined) => (theme: Theme) => ({
      '& textarea': { color: 'transparent', caretColor: color ?? theme.vars.palette.text.secondary },
    }),
    expandButton: { marginLeft: 0 },
    expandIcon: (iconColor: string | undefined) => (theme: Theme) => ({
      width: '1rem',
      height: '1rem',
      color: iconColor ?? theme.vars.palette.icon.fill.default,
    }),
    footer: {
      display: 'flex',
      justifyContent: 'space-between',
      width: '100%',
      alignItems: 'center',
      minHeight: '2.5rem',
      gap: { xs: '.5rem', sm: '0.5rem' },
    },
    sendButtonContainer: {
      display: 'flex',
      height: 'auto',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stopButton: (iconColor: string | undefined) => (theme: Theme) => ({
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      color: iconColor ?? theme.vars.palette.icon.fill.attention,
      marginLeft: 0,
    }),
  };
}

export type UserInputStyles = ReturnType<typeof userInputStyles>;
