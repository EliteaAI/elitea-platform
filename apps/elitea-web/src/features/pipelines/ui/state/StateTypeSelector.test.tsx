import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { StateTypeSelector } from './StateTypeSelector';

describe('StateTypeSelector', () => {
  it('opens the type menu and lists every state variable type', () => {
    renderWithTheme(
      <StateTypeSelector
        type="str"
        onTypeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('String')).toBeInTheDocument();
    expect(screen.getByText('Number')).toBeInTheDocument();
    expect(screen.getByText('List')).toBeInTheDocument();
    expect(screen.getByText('Json')).toBeInTheDocument();
  });

  it('calls onTypeChange with the picked type and closes the menu', async () => {
    const onTypeChange = vi.fn();
    renderWithTheme(
      <StateTypeSelector
        type="str"
        onTypeChange={onTypeChange}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Number'));

    expect(onTypeChange).toHaveBeenCalledWith('number');
    // MUI's `Menu` keeps its DOM node mounted through its (jsdom-inert)
    // exit transition — assert the eventual state, not the synchronous one.
    await waitFor(() => expect(screen.queryByText('List')).not.toBeInTheDocument());
  });

  it('does not open the menu when disabled', () => {
    renderWithTheme(
      <StateTypeSelector
        type="str"
        onTypeChange={vi.fn()}
        disabled
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Number')).not.toBeInTheDocument();
  });
});
