import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { EmptyMcpTools } from './EmptyMcpTools';

describe('EmptyMcpTools', () => {
  it('renders the load-tools hint message', () => {
    const { getByText } = renderWithTheme(<EmptyMcpTools />);
    expect(getByText(/No tools to display for now/)).toBeInTheDocument();
  });

  it('hides its icon from assistive technology (purely decorative)', () => {
    const { container } = renderWithTheme(<EmptyMcpTools />);
    const icon = container.querySelector('svg[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });
});
