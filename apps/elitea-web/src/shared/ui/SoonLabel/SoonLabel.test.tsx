import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { SoonLabel } from '.';

describe('SoonLabel', () => {
  it('renders the supplied label text', () => {
    const { getByText } = renderWithTheme(<SoonLabel text="Bulk export" />);
    expect(getByText('Bulk export')).toBeInTheDocument();
  });

  it('always renders the "Soon" pill', () => {
    const { getByText } = renderWithTheme(<SoonLabel text="Anything" />);
    expect(getByText('Soon')).toBeInTheDocument();
  });

  it('renders ReactNode text content, not just strings', () => {
    const { getByTestId } = renderWithTheme(<SoonLabel text={<span data-testid="custom-node">Custom</span>} />);
    expect(getByTestId('custom-node')).toBeInTheDocument();
  });
});
