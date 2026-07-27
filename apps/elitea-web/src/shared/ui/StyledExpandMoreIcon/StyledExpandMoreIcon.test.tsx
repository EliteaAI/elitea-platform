import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { StyledExpandMoreIcon } from '.';

describe('StyledExpandMoreIcon', () => {
  it('renders an svg icon', () => {
    const { container } = renderWithTheme(<StyledExpandMoreIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('forwards additional props to the underlying icon', () => {
    const { container } = renderWithTheme(<StyledExpandMoreIcon data-testid="expand-icon" />);
    expect(container.querySelector('[data-testid="expand-icon"]')).toBeInTheDocument();
  });
});
