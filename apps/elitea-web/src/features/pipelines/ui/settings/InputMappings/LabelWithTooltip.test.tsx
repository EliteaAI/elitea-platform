import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { LabelWithTooltip } from './LabelWithTooltip';

describe('LabelWithTooltip', () => {
  it('renders the default "Value" text when no title is given', () => {
    const { getByText } = renderWithTheme(<LabelWithTooltip />);
    expect(getByText('Value')).toBeInTheDocument();
  });

  it('renders a custom title', () => {
    const { getByText, queryByText } = renderWithTheme(<LabelWithTooltip title="Custom" />);
    expect(getByText('Custom')).toBeInTheDocument();
    expect(queryByText('Value')).not.toBeInTheDocument();
  });

  it('renders no text at all when title is explicitly the empty string', () => {
    const { queryByText, container } = renderWithTheme(<LabelWithTooltip title="" />);
    expect(queryByText('Value')).not.toBeInTheDocument();
    // No tooltip either in this case, so the span renders empty.
    expect(container.querySelector('span')?.textContent).toBe('');
  });

  it('falls back to "Value" when title is explicitly undefined (preserved baseline quirk)', () => {
    const { getByText } = renderWithTheme(<LabelWithTooltip title={undefined} />);
    expect(getByText('Value')).toBeInTheDocument();
  });

  it('renders no info icon when tooltip is omitted', () => {
    const { queryByRole } = renderWithTheme(<LabelWithTooltip />);
    expect(queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders an info icon button when tooltip is provided', () => {
    const { getByRole } = renderWithTheme(<LabelWithTooltip tooltip="Helpful text" />);
    expect(getByRole('button', { name: 'Helpful text' })).toBeInTheDocument();
  });
});
