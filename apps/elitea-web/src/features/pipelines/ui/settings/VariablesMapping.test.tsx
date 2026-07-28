import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { VariablesMapping } from './VariablesMapping';

describe('VariablesMapping', () => {
  it('shows the entry count in the accordion title', () => {
    const { getByText } = renderWithTheme(
      <VariablesMapping
        variables_mapping={{ output: { type: 'fixed', value: 'a' } }}
        onChangeMapping={vi.fn()}
      />,
    );
    expect(getByText('Variables mapping(1)')).toBeInTheDocument();
  });

  it('shows a count of 0 when there are no entries', () => {
    const { getByText } = renderWithTheme(
      <VariablesMapping
        onChangeMapping={vi.fn()}
      />,
    );
    expect(getByText('Variables mapping(0)')).toBeInTheDocument();
  });

  it('uses the capitalised key as the row label when no explicit label is set', () => {
    const { getByText } = renderWithTheme(
      <VariablesMapping
        variables_mapping={{ my_output: { type: 'fixed', value: 'a' } }}
        onChangeMapping={vi.fn()}
      />,
    );
    expect(getByText('My output')).toBeInTheDocument();
  });

  it('shows an editable value field for a fixed entry and reports edits', async () => {
    const user = userEvent.setup();
    const onChangeMapping = vi.fn();
    const { getByRole } = renderWithTheme(
      <VariablesMapping
        variables_mapping={{ output: { type: 'fixed', value: 'a' } }}
        onChangeMapping={onChangeMapping}
      />,
    );
    const input = getByRole('textbox');
    await user.type(input, '!');
    expect(onChangeMapping).toHaveBeenCalled();
    const [field, payload] = onChangeMapping.mock.calls[0] as [string, { type: string; value: unknown }];
    expect(field).toBe('output');
    expect(payload.type).toBe('fixed');
  });

  it('hides the Source selector for a "fixed" typed entry, keeping its Type selector', () => {
    const { getByRole, queryByRole } = renderWithTheme(
      <VariablesMapping
        variables_mapping={{ output: { type: 'fixed', value: 'a' } }}
        onChangeMapping={vi.fn()}
      />,
    );
    expect(queryByRole('combobox', { name: 'Source' })).not.toBeInTheDocument();
    expect(getByRole('combobox', { name: 'Type' })).toBeInTheDocument();
  });

  it('shows the Source selector for a "variable" typed entry', () => {
    const { getByRole } = renderWithTheme(
      <VariablesMapping
        variables_mapping={{ output: { type: 'variable', source: 'state', value: 'input' } }}
        onChangeMapping={vi.fn()}
      />,
    );
    expect(getByRole('combobox', { name: 'Source' })).toBeInTheDocument();
  });

  it('shows a state-variable dropdown, not a text field, for a "variable" type sourced from state', () => {
    const { getByRole, queryByRole } = renderWithTheme(
      <VariablesMapping
        variables_mapping={{ output: { type: 'variable', source: 'state', value: 'input' } }}
        onChangeMapping={vi.fn()}
      />,
    );
    expect(queryByRole('textbox')).not.toBeInTheDocument();
    expect(getByRole('combobox', { name: /no tooltips here/i })).toBeInTheDocument();
  });

  it('reports a JSON-parsed value when the field type is "fixed" and the input parses as JSON', async () => {
    const user = userEvent.setup();
    const onChangeMapping = vi.fn();
    const { getByRole } = renderWithTheme(
      <VariablesMapping
        variables_mapping={{ output: { type: 'fixed', value: '' } }}
        onChangeMapping={onChangeMapping}
      />,
    );
    await user.type(getByRole('textbox'), '1');
    const lastCall = onChangeMapping.mock.calls.at(-1) as [string, { value: unknown }];
    expect(lastCall[1].value).toBe(1);
  });
});
