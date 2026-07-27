import type { Decorator, Preview } from '@storybook/react-vite';

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';

// Relative import, not the `@/*` alias: tsgolint's type-aware pass only
// fully resolves the alias for files inside tsconfig's `src` root; verified
// by isolated repro (identical content lints clean under `src/`, errors
// under `.storybook/` — see oxlint no-unsafe-assignment/no-unsafe-call at
// this file's `buildEliteaTheme` call site with the `@/` form). A relative
// import avoids the discrepancy without touching the (F2-owned) lint config.
import { DEFAULT_COLOR_SCHEME, buildEliteaTheme, DEFAULT_BRAND_PACK } from '../src/shared/brand';

/**
 * spec §6.4 — project-level Storybook annotations for `shared/ui`.
 *
 * Every story renders inside the real Elitea theme (built from the same
 * `DEFAULT_BRAND_PACK` the app ships), because the whole point of R-T7 is
 * that components read `theme.vars.palette.*` — a story with no
 * `ThemeProvider` would render unstyled and could not catch a raw-token
 * regression visually.
 *
 * `a11y.test: 'error'` is the fix for the old app's defect (§6.4 / this
 * unit's brief): `apps/elitea-ui/.storybook/preview.js` set `'todo'`, so a
 * real violation could only ever produce a warning, never fail CI.
 */
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

const withEliteaTheme: Decorator = (Story) => (
  <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
    <CssBaseline />
    <Story />
  </ThemeProvider>
);

const preview: Preview = {
  decorators: [withEliteaTheme],
  parameters: {
    a11y: {
      test: 'error',
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
