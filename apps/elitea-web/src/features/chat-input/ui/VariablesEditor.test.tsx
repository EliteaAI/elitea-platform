import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { VariablesEditor } from './VariablesEditor';

const variables = [
  { key: 'apiKey', value: 'secret' },
  { name: 'region', value: 'us-east-1' },
];

describe('VariablesEditor', () => {
  it('shows the "Variables" label by default, and the icon in small view', () => {
    const { rerender } = renderWithTheme(
      <VariablesEditor
        variables={variables}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'variables selector menu' })).toHaveTextContent('Variables');

    rerender(
      <VariablesEditor
        variables={variables}
        onChange={vi.fn()}
        isSmallView
      />,
    );
    expect(screen.getByRole('button', { name: 'variables selector menu' })).not.toHaveTextContent('Variables');
  });

  it('opens the dialog with one field per variable, keyed by key-or-name', () => {
    renderWithTheme(
      <VariablesEditor
        variables={variables}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'variables selector menu' }));
    expect(screen.getByLabelText('apiKey')).toHaveValue('secret');
    expect(screen.getByLabelText('region')).toHaveValue('us-east-1');
  });

  it('calls onChange with the edited variables and closes on Apply', async () => {
    const onChange = vi.fn();
    renderWithTheme(
      <VariablesEditor
        variables={variables}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'variables selector menu' }));
    fireEvent.change(screen.getByLabelText('apiKey'), { target: { value: 'new-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledWith([
      { key: 'apiKey', value: 'new-secret' },
      { name: 'region', value: 'us-east-1' },
    ]);
    await waitFor(() => expect(screen.queryByLabelText('apiKey')).not.toBeInTheDocument());
  });

  it('discards edits on Cancel', async () => {
    const onChange = vi.fn();
    renderWithTheme(
      <VariablesEditor
        variables={variables}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'variables selector menu' }));
    fireEvent.change(screen.getByLabelText('apiKey'), { target: { value: 'discarded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText('apiKey')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'variables selector menu' }));
    expect(screen.getByLabelText('apiKey')).toHaveValue('secret');
  });
});
