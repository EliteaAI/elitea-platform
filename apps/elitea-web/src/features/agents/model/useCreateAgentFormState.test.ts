import type { ChangeEvent } from 'react';

import { describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

import { renderHookWithProviders } from '../__tests__/testUtils';

import { useCreateAgentFormState } from './useCreateAgentFormState';

describe('useCreateAgentFormState', () => {
  it('reflects the caller-supplied name/description', () => {
    const { result } = renderHookWithProviders(() => useCreateAgentFormState({ name: 'My Agent', description: 'Does things' }, vi.fn()));
    expect(result.current.name).toBe('My Agent');
    expect(result.current.description).toBe('Does things');
  });

  it('onChangeName mirrors the input into local state AND calls onFieldChange', () => {
    const onFieldChange = vi.fn();
    const { result } = renderHookWithProviders(() => useCreateAgentFormState({ name: '' }, onFieldChange));
    act(() => {
      result.current.onChangeName({ target: { value: 'New Name' } } as ChangeEvent<HTMLInputElement>);
    });
    expect(onFieldChange).toHaveBeenCalledWith('name', 'New Name');
  });

  it('onNameBlur trims whitespace before committing', () => {
    const onFieldChange = vi.fn();
    const { result } = renderHookWithProviders(() => useCreateAgentFormState({ name: '' }, onFieldChange));
    act(() => {
      result.current.onChangeName({ target: { value: '  Padded  ' } } as ChangeEvent<HTMLInputElement>);
    });
    act(() => {
      result.current.onNameBlur();
    });
    expect(onFieldChange).toHaveBeenLastCalledWith('name', 'Padded');
  });

  it('onChangeVariable updates only the matching variable, by name', () => {
    const onFieldChange = vi.fn();
    const { result } = renderHookWithProviders(() =>
      useCreateAgentFormState(
        {
          name: 'a',
          version_details: {
            variables: [
              { name: 'first', value: 'old-first' },
              { name: 'second', value: 'old-second' },
            ],
          },
        },
        onFieldChange,
      ),
    );
    act(() => {
      result.current.onChangeVariable('second', 'new-second');
    });
    expect(onFieldChange).toHaveBeenCalledWith('version_details.variables', [
      { name: 'first', value: 'old-first' },
      { name: 'second', value: 'new-second' },
    ]);
  });

  it('nameAtMax is false below MAX_NAME_LENGTH and true exactly at it', () => {
    const { result: below } = renderHookWithProviders(() => useCreateAgentFormState({ name: 'short' }, vi.fn()));
    expect(below.current.nameAtMax).toBe(false);

    const { result: atMax } = renderHookWithProviders(() => useCreateAgentFormState({ name: 'x'.repeat(32) }, vi.fn()));
    expect(atMax.current.nameAtMax).toBe(true);
  });

  it('onStepLimitChange forwards the field path and value verbatim', () => {
    const onFieldChange = vi.fn();
    const { result } = renderHookWithProviders(() => useCreateAgentFormState({ name: 'a' }, onFieldChange));
    act(() => {
      result.current.onStepLimitChange(42);
    });
    expect(onFieldChange).toHaveBeenCalledWith('version_details.meta.step_limit', 42);
  });
});
