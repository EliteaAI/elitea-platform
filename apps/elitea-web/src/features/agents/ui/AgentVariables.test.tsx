import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AgentVariables } from './AgentVariables';

describe('AgentVariables', () => {
  it('renders nothing when there are no variables', () => {
    const { container } = renderWithTheme(
      <AgentVariables
        variables={[]}
        onChangeVariable={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when variables is undefined', () => {
    const { container } = renderWithTheme(
      <AgentVariables
        variables={undefined}
        onChangeVariable={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one field per variable, labelled with the variable name', () => {
    const { getByLabelText } = renderWithTheme(
      <AgentVariables
        variables={[
          { name: 'API_KEY', value: 'abc' },
          { name: 'REGION', value: 'us-east-1' },
        ]}
        onChangeVariable={vi.fn()}
      />,
    );
    expect(getByLabelText('API_KEY')).toHaveValue('abc');
    expect(getByLabelText('REGION')).toHaveValue('us-east-1');
  });

  it('calls onChangeVariable with the variable name and new value on edit', async () => {
    const user = userEvent.setup();
    const onChangeVariable = vi.fn();
    const { getByLabelText } = renderWithTheme(
      <AgentVariables
        variables={[{ name: 'API_KEY', value: 'abc' }]}
        onChangeVariable={onChangeVariable}
      />,
    );
    await user.type(getByLabelText('API_KEY'), '!');

    expect(onChangeVariable).toHaveBeenCalledWith('API_KEY', 'abc!');
  });
});
