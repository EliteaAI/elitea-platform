import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

import { Toolkits } from './Toolkits';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderPage(isMCP = false) {
  return render(
    <ThemeProvider
      theme={theme}
      defaultMode={DEFAULT_COLOR_SCHEME}
    >
      <Toolkits isMCP={isMCP} />
    </ThemeProvider>,
  );
}

describe('Toolkits', () => {
  it('renders the Toolkits title and list placeholder by default', () => {
    renderPage();
    expect(screen.getByText('Toolkits')).toBeInTheDocument();
    expect(screen.getByTestId('toolkits-list-panel')).toBeInTheDocument();
  });

  it('renders the MCPs title and list placeholder when isMCP is true', () => {
    renderPage(true);
    expect(screen.getByText('MCPs')).toBeInTheDocument();
    expect(screen.getByTestId('mcps-list-panel')).toBeInTheDocument();
  });
});
