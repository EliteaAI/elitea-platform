import { useRef } from 'react';

import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { ToolFormFieldProps } from './IndexConfig';
import { IndexViews } from './IndexViews';

function FakeToolFormField(props: ToolFormFieldProps) {
  return <div>{props.fieldKey}</div>;
}

const schema = { properties: { index_name: { type: 'string' } } };

function Harness(overrides: Partial<Parameters<typeof IndexViews>[0]> = {}) {
  const configInitialized = useRef(false);
  return (
    <IndexViews
      activeView="run"
      schema={schema}
      configInitialized={configInitialized}
      initializeDefaultConfigValues={vi.fn()}
      toolInputVariables={{}}
      onChangeInputVariables={vi.fn()}
      index={null}
      ToolFormField={FakeToolFormField}
      {...overrides}
    />
  );
}

describe('IndexViews', () => {
  it('renders IndexConfig (run mode) with the schema fields for the "run" tab', () => {
    const { getByText } = renderWithTheme(<Harness activeView="run" />);
    expect(getByText('index_name')).toBeInTheDocument();
  });

  it('renders IndexConfig (locked) for the "configuration" tab', () => {
    const { getByText } = renderWithTheme(<Harness activeView="configuration" />);
    expect(getByText('index_name')).toBeInTheDocument();
  });

  it('renders IndexHistory for the "history" tab, reading history off index.metadata', () => {
    const { getByText } = renderWithTheme(
      <Harness
        activeView="history"
        index={{ id: '1', metadata: { history: [{ state: 'completed', updated_on: 1 }] } }}
      />,
    );
    expect(getByText('Reindexed')).toBeInTheDocument();
  });

  it('defaults to an empty history array when index has none', () => {
    const { queryByText } = renderWithTheme(<Harness activeView="history" />);
    expect(queryByText('Reindexed')).not.toBeInTheDocument();
  });
});
