import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { NodeBodyContainer } from './NodeBodyContainer';

describe('NodeBodyContainer', () => {
  it('renders its children', () => {
    renderWithTheme(
      <NodeBodyContainer>
        <span>body content</span>
      </NodeBodyContainer>,
    );

    expect(screen.getByText('body content')).toBeInTheDocument();
  });

  it('defaults to display:flex', () => {
    renderWithTheme(
      <NodeBodyContainer>
        <span data-testid="child" />
      </NodeBodyContainer>,
    );

    const container = screen.getByTestId('child').parentElement;
    expect(container).toHaveStyle({ display: 'flex' });
  });

  it('honours an explicit display="none"', () => {
    renderWithTheme(
      <NodeBodyContainer display="none">
        <span data-testid="child" />
      </NodeBodyContainer>,
    );

    const container = screen.getByTestId('child').parentElement;
    expect(container).toHaveStyle({ display: 'none' });
  });
});
