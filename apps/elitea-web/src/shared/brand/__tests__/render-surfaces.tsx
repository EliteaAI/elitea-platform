import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { render } from '@testing-library/react';

import type { EliteaTheme } from '../buildTheme';
import { AllSurfaces } from './surfaces';

/**
 * Render every currently-available surface under a given theme and hand the
 * document back for sampling (§4.6 check 7 assertion (c)).
 *
 * `CssBaseline` is included because it is what forces MUI to emit the
 * colour-scheme variable stylesheets into the document rather than keeping
 * them on the theme object only.
 */
export function renderAllSurfaces(theme: EliteaTheme): {
  document: Document;
  unmount: () => void;
} {
  const view = render(
    <ThemeProvider theme={theme} defaultMode="dark">
      <CssBaseline />
      <AllSurfaces />
    </ThemeProvider>,
  );
  return { document: view.baseElement.ownerDocument, unmount: view.unmount };
}
