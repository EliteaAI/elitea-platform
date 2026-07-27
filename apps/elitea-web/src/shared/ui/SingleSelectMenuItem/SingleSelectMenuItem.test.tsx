import userEvent from '@testing-library/user-event';
import Menu from '@mui/material/Menu';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import type { SingleSelectOption } from '.';
import { SingleSelectMenuItem } from '.';

const option: SingleSelectOption = { value: 'claude', label: 'Claude' };

// `SingleSelectMenuItem` renders a `<MenuItem>` (an `<li>`) — real markup
// only inside a `<Menu>`'s list, so every test wraps it the same way
// `SingleSelect` does.
function renderRow(props: Partial<React.ComponentProps<typeof SingleSelectMenuItem>> = {}) {
  return renderWithTheme(
    <Menu
      open
      anchorReference="none"
    >
      <SingleSelectMenuItem
        option={option}
        value={option.value}
        isSelected={false}
        {...props}
      />
    </Menu>,
  );
}

describe('SingleSelectMenuItem', () => {
  it('renders the option label', () => {
    const { getByRole } = renderRow();
    expect(getByRole('menuitem', { name: 'Claude' })).toBeInTheDocument();
  });

  it('renders a leading icon when the option has one', () => {
    const { getByTestId } = renderRow({ option: { ...option, icon: <span data-testid="icon" /> } });
    expect(getByTestId('icon')).toBeInTheDocument();
  });

  it('renders the description under the label when present', () => {
    const { getByText } = renderRow({ option: { ...option, description: '200k context' } });
    expect(getByText('200k context')).toBeInTheDocument();
    expect(getByText('Claude')).toBeInTheDocument();
  });

  it('marks a disabled option aria-disabled', () => {
    const { getByRole } = renderRow({ option: { ...option, disabled: true } });
    expect(getByRole('menuitem', { name: 'Claude' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('calls the injected onClick for an unselected row', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByRole } = renderRow({ onClick });
    await user.click(getByRole('menuitem', { name: 'Claude' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClear instead of onClick when the already-selected row is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onClear = vi.fn();
    const { getByRole } = renderRow({ isSelected: true, onClick, onClear });
    await user.click(getByRole('menuitem', { name: 'Claude' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('falls back to onClick when selected but no onClear is given', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { getByRole } = renderRow({ isSelected: true, onClick });
    await user.click(getByRole('menuitem', { name: 'Claude' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
