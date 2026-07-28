import { useRef } from 'react';

import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { IndexConfig } from './IndexConfig';
import type { ToolFormFieldProps } from './IndexConfig';

function FakeToolFormField(props: ToolFormFieldProps) {
  return <div data-testid={`field-${props.fieldKey}`}>{props.fieldKey}</div>;
}

const schema = { properties: { index_name: { type: 'string' }, query: { type: 'string' } } };

function Harness(overrides: Partial<Parameters<typeof IndexConfig>[0]> = {}) {
  const configInitialized = useRef(false);
  return (
    <IndexConfig
      schema={schema}
      configInitialized={configInitialized}
      initializeDefaultConfigValues={vi.fn()}
      toolInputVariables={{}}
      onChangeInputVariables={vi.fn()}
      ToolFormField={FakeToolFormField}
      {...overrides}
    />
  );
}

describe('IndexConfig', () => {
  it('calls initializeDefaultConfigValues once when the schema first has properties', () => {
    const initialize = vi.fn();
    renderWithTheme(<Harness initializeDefaultConfigValues={initialize} />);
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('renders one ToolFormField per schema property', () => {
    const { getByTestId } = renderWithTheme(<Harness />);
    expect(getByTestId('field-index_name')).toBeInTheDocument();
    expect(getByTestId('field-query')).toBeInTheDocument();
  });

  it('without toolsConfig, renders no tool selector and no Run button', () => {
    const { queryByRole, queryByLabelText } = renderWithTheme(<Harness />);
    expect(queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
    expect(queryByLabelText('Tool')).not.toBeInTheDocument();
  });

  it('with toolsConfig, renders the tool selector filtered to selectedIndexTools and a Run button', () => {
    const onChangeTool = vi.fn();
    const { getByText, queryByText } = renderWithTheme(
      <Harness
        toolsConfig={{
          selectedRunTool: 'search_index',
          onChangeTool,
          handleRunTool: vi.fn(),
          selectedIndexTools: ['search_index'],
        }}
        isValidForm
      />,
    );
    expect(getByText('Search Index')).toBeInTheDocument();
    expect(queryByText('Stepback Search Index')).not.toBeInTheDocument();
  });

  it('Run button calls handleRunTool and is disabled when the form is invalid', async () => {
    const user = userEvent.setup();
    const handleRunTool = vi.fn();
    const { getByRole, rerender } = renderWithTheme(
      <Harness
        toolsConfig={{ selectedRunTool: 'search_index', onChangeTool: vi.fn(), handleRunTool, selectedIndexTools: ['search_index'] }}
        isValidForm
      />,
    );
    await user.click(getByRole('button', { name: 'Run' }));
    expect(handleRunTool).toHaveBeenCalled();

    rerender(
      <Harness
        toolsConfig={{ selectedRunTool: 'search_index', onChangeTool: vi.fn(), handleRunTool, selectedIndexTools: ['search_index'] }}
        isValidForm={false}
      />,
    );
    expect(getByRole('button', { name: 'Run' })).toBeDisabled();
  });
});
