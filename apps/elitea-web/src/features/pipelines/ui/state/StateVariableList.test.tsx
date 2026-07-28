import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_BRAND_PACK, buildEliteaTheme } from '@/shared/brand';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { StateVariableList, type StateVariableListProps } from './StateVariableList';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function baseProps(overrides: Partial<StateVariableListProps> = {}): StateVariableListProps {
  return {
    states: undefined,
    onDeleteState: vi.fn(),
    onToggleState: vi.fn(),
    onUpdateState: vi.fn(),
    onAddState: vi.fn(() => true),
    ...overrides,
  };
}

describe('StateVariableList', () => {
  it('always renders the input and messages rows', () => {
    renderWithTheme(<StateVariableList {...baseProps()} />);
    expect(screen.getByText('input')).toBeInTheDocument();
    expect(screen.getByText('messages')).toBeInTheDocument();
  });

  it('renders one row per custom state variable, excluding input/messages', () => {
    renderWithTheme(
      <StateVariableList
        {...baseProps({
          states: {
            input: { type: 'str' },
            messages: { type: 'list' },
            counter: { type: 'number', value: 0 },
          },
        })}
      />,
    );

    expect(screen.getByText('counter')).toBeInTheDocument();
  });

  it('opens a create row and calls onAddState with the typed name on blur', () => {
    const onAddState = vi.fn(() => true);
    renderWithTheme(<StateVariableList {...baseProps({ onAddState })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Context' }));
    const input = screen.getByPlaceholderText('name');
    fireEvent.change(input, { target: { value: 'new_var' } });
    fireEvent.blur(input);

    expect(onAddState).toHaveBeenCalledWith('new_var', 'str');
  });

  it('renders the input_attachments row only when present in state', () => {
    const { rerender } = renderWithTheme(<StateVariableList {...baseProps()} />);
    expect(screen.queryByText('input_attachments')).not.toBeInTheDocument();

    rerender(
      <StateVariableList
        {...baseProps({ states: { input_attachments: { type: 'list' } } })}
      />,
    );
    expect(screen.getByText('input_attachments')).toBeInTheDocument();
  });

  // Baseline `addButton` style sets `fontSize: '.75rem'` (matched here off
  // `theme.typography.bodySmall.fontSize`, R-T11) — asserted directly on
  // the rendered button rather than by re-resolving `addButtonSx` in
  // isolation, since `fontSize` on a MUI `Button` only takes effect when
  // it actually lands on the rendered root.
  it('sizes the "Context" add button off the bodySmall typography fontSize', () => {
    renderWithTheme(<StateVariableList {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Context' })).toHaveStyle({
      fontSize: theme.typography.bodySmall.fontSize,
    });
  });
});
