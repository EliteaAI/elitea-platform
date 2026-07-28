import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { FStringAutocompletePopper } from './FStringAutocompletePopper';

const OPTIONS = [
  { value: 'foo', label: 'Foo' },
  { value: 'bar', label: 'Bar' },
];

describe('FStringAutocompletePopper', () => {
  it('renders nothing (no options) when closed', () => {
    const { queryByTestId } = renderWithTheme(
      <FStringAutocompletePopper
        open={false}
        anchorEl={null}
        options={OPTIONS}
        highlightedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(queryByTestId('fstring-autocomplete-popper')).not.toBeInTheDocument();
  });

  it('lists every option by label when open', () => {
    const { getByText, getAllByTestId } = renderWithTheme(
      <FStringAutocompletePopper
        open
        anchorEl={null}
        options={OPTIONS}
        highlightedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(getByText('Foo')).toBeInTheDocument();
    expect(getByText('Bar')).toBeInTheDocument();
    expect(getAllByTestId('fstring-autocomplete-option')).toHaveLength(2);
  });

  it('marks the highlighted option as selected', () => {
    const { getAllByTestId } = renderWithTheme(
      <FStringAutocompletePopper
        open
        anchorEl={null}
        options={OPTIONS}
        highlightedIndex={1}
        onSelect={vi.fn()}
      />,
    );
    const items = getAllByTestId('fstring-autocomplete-option');
    expect(items[0]).not.toHaveClass('Mui-selected');
    expect(items[1]).toHaveClass('Mui-selected');
  });

  it('calls onSelect with the option value on click', () => {
    const onSelect = vi.fn();
    const { getByText } = renderWithTheme(
      <FStringAutocompletePopper
        open
        anchorEl={null}
        options={OPTIONS}
        highlightedIndex={0}
        onSelect={onSelect}
      />,
    );
    getByText('Bar').click();
    expect(onSelect).toHaveBeenCalledWith('bar');
  });

  it('prevents the default mousedown action so the input never loses focus before the click registers', () => {
    const { getByText } = renderWithTheme(
      <FStringAutocompletePopper
        open
        anchorEl={null}
        options={OPTIONS}
        highlightedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    getByText('Foo').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
