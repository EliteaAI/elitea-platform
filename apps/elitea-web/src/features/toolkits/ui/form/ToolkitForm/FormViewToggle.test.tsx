import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { FormViewToggle } from './FormViewToggle';

describe('FormViewToggle', () => {
  it('renders Form and Raw Json options', () => {
    const { getByText } = renderWithTheme(
      <FormViewToggle
        view="form"
        onChangeView={vi.fn()}
      />,
    );
    expect(getByText('Form')).toBeInTheDocument();
    expect(getByText('Raw Json')).toBeInTheDocument();
  });

  it('calls onChangeView with the newly selected view', () => {
    const onChangeView = vi.fn();
    const { getByText } = renderWithTheme(
      <FormViewToggle
        view="form"
        onChangeView={onChangeView}
      />,
    );
    fireEvent.click(getByText('Raw Json'));
    expect(onChangeView).toHaveBeenCalledWith('json');
  });

  it('does not call onChangeView when clicking the already-selected view', () => {
    const onChangeView = vi.fn();
    const { getByText } = renderWithTheme(
      <FormViewToggle
        view="form"
        onChangeView={onChangeView}
      />,
    );
    fireEvent.click(getByText('Form'));
    expect(onChangeView).not.toHaveBeenCalled();
  });

  it('defaults to the Form view when no view is supplied', () => {
    const { getByRole } = renderWithTheme(
      <FormViewToggle onChangeView={vi.fn()} />,
    );
    expect(getByRole('button', { name: /Form/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
