import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { InputMapping } from './InputMapping';

describe('InputMapping', () => {
  it('renders nothing when input_mapping is empty', () => {
    const { queryByText } = renderWithTheme(
      <InputMapping
        input_mapping={{}}
        onChangeMapping={vi.fn()}
      />,
    );
    expect(queryByText(/Input mapping/)).not.toBeInTheDocument();
  });

  it('splits keys into a required section and an optional section, with correct counts', () => {
    const { getByText } = renderWithTheme(
      <InputMapping
        input_mapping={{
          task: { type: 'fstring', value: '' },
          extra: { type: 'fixed', value: '' },
        }}
        requiredInputs={['task']}
        onChangeMapping={vi.fn()}
      />,
    );
    expect(getByText('Input mapping (required 1)')).toBeInTheDocument();
    expect(getByText('Input mapping (optional 1)')).toBeInTheDocument();
  });

  it('renders only the required section when every key is required', () => {
    const { getByText, queryByText } = renderWithTheme(
      <InputMapping
        input_mapping={{ task: { type: 'fstring', value: '' } }}
        requiredInputs={['task']}
        onChangeMapping={vi.fn()}
      />,
    );
    expect(getByText('Input mapping (required 1)')).toBeInTheDocument();
    expect(queryByText(/optional/)).not.toBeInTheDocument();
  });

  it('renders a titled input-mapping row using capitalised key text as a fallback variable name', () => {
    const { getByText } = renderWithTheme(
      <InputMapping
        input_mapping={{ my_variable: { type: 'fixed', value: '' } }}
        onChangeMapping={vi.fn()}
      />,
    );
    expect(getByText('My variable')).toBeInTheDocument();
  });

  it("prefers a mapping entry's own title over the capitalised key", () => {
    const { getByText, queryByText } = renderWithTheme(
      <InputMapping
        input_mapping={{ my_variable: { type: 'fixed', value: '', title: 'Custom Title' } }}
        onChangeMapping={vi.fn()}
      />,
    );
    expect(getByText('Custom Title')).toBeInTheDocument();
    expect(queryByText('My variable')).not.toBeInTheDocument();
  });

  it('defaults a missing array-typed value to an empty array (no crash rendering the enum select)', () => {
    const { getByText } = renderWithTheme(
      <InputMapping
        input_mapping={{ tags: { type: 'fixed', value: undefined } }}
        mappingInfo={{ tags: { type: 'fixed', value: undefined, data_type: 'array', enum: ['a', 'b'] } }}
        onChangeMapping={vi.fn()}
      />,
    );
    expect(getByText('Tags')).toBeInTheDocument();
  });
});
