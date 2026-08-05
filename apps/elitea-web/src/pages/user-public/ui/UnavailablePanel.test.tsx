import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { UnavailablePanel } from './UnavailablePanel';

describe('UnavailablePanel', () => {
  it('renders the given reason as the description', () => {
    const { getByText } = renderWithTheme(<UnavailablePanel reason="Toolkits are not listable yet." />);
    expect(getByText('Toolkits are not listable yet.')).toBeInTheDocument();
  });

  it('renders a title', () => {
    const { getByText } = renderWithTheme(<UnavailablePanel reason="x" />);
    expect(getByText('This list is not available yet.')).toBeInTheDocument();
  });
});
