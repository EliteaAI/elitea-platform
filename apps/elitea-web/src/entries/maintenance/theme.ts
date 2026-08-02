import { createTheme } from '@mui/material/styles';

/**
 * Standalone MUI theme for the maintenance entry point.
 *
 * Reuses the same palette, typography, and component overrides from the main
 * app so the maintenance splash renders consistently with Elitea's design system.
 *
 * The gradient and shadow tokens (onboarding, welcome, boxShadow.onboarding)
 * are already defined in the main app's theme under `background.*` — importing
 * the shared theme would create a circular dependency, so we copy the token
 * definitions here and let the main app's theme serve as the single source of
 * truth for what those values should be.
 */
export default createTheme({
  palette: {
    mode: 'light',
    background: {
      default: '#F8FCFF',
      eliteaDefault: 'linear-gradient(270deg, #EBF1F8 0%, #FFF9FF 100%)',
      onboarding:
        'linear-gradient(247.51deg, rgba(161, 197, 255, 0.6) 0.02%, rgba(161, 197, 255, 0.12) 50.21%, rgba(161, 214, 255, 0.6) 99.64%)',
      onboardingBody: 'rgba(250, 250, 250, 1)',
      welcome: {
        outside:
          'linear-gradient(42.04deg, rgba(97, 237, 233, 0.4) 8.85%, rgba(251, 66, 255, 0.4) 89.62%)',
        inner:
          'linear-gradient(63.16deg, rgba(41, 169, 165, 0.14) 16.12%, rgba(231, 47, 235, 0.14) 85.3%)',
      },
    },
    text: {
      secondary: '#0E131D',
    },
    icon: {
      fill: {
        magicAssistant: 'rgba(244, 124, 255, 1)',
      },
    },
  } as any,
  components: {
    MuiCssBaseline: {
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
        textArea: {
          caretColor: 'auto',
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableRipple: true,
      },
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontFamily: '"Montserrat", Roboto, Arial, sans-serif',
          fontWeight: 500,
          borderRadius: '28px',
        },
      },
    },
  },
});
