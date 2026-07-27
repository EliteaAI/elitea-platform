import type { ReactElement, ReactNode } from 'react';

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { render, type RenderResult } from '@testing-library/react';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

/**
 * Shared render helper for `shared/ui` component tests (spec §6.2).
 *
 * Every component reads `theme.vars.palette.*` (R-T7), so a bare
 * `@testing-library/react` `render()` with no `ThemeProvider` would throw
 * the moment a component touches `theme.vars` — this wraps the real Elitea
 * theme once so every test file does not repeat the boilerplate.
 */
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

const wrap = (ui: ReactNode): ReactElement => (
  <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
    <CssBaseline />
    {ui}
  </ThemeProvider>
);

/**
 * `result.rerender(nextUi)` re-wraps `nextUi` in the same `ThemeProvider`
 * rather than replacing the whole tree with an unwrapped element — RTL's
 * own `rerender` re-renders exactly the element it is given, so calling it
 * with a bare (unwrapped) `nextUi` would unmount the `ThemeProvider` too and
 * every `theme.vars.*` read in the component under test would throw on the
 * next render.
 */
export function renderWithTheme(ui: ReactElement): RenderResult {
  const result = render(wrap(ui));
  return {
    ...result,
    rerender: (nextUi: ReactNode) => {
      result.rerender(wrap(nextUi));
    },
  };
}
