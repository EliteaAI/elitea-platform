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

  /*
   * Variable AUTHORING — the baseline's `updateVariableList`
   * (`apps/elitea-ui/src/[fsd]/features/agent/ui/agent-details/
   * configurations/input/InstructionsInput.jsx:85-101`), restored. See
   * `deriveVariablesFromInstructions`'s own doc comment for the measured
   * baseline rules each of these pins.
   */
  describe('onInstructionsChange derives the variable rows from the instructions', () => {
    it('surfaces a row with an empty value for a newly typed placeholder', () => {
      const onFieldChange = vi.fn();
      const { result } = renderHookWithProviders(() =>
        useCreateAgentFormState({ name: 'a', version_details: { instructions: '', variables: [] } }, onFieldChange),
      );
      act(() => {
        result.current.onInstructionsChange('Summarize {{topic}} for the reader.');
      });
      expect(onFieldChange).toHaveBeenCalledWith('version_details.instructions', 'Summarize {{topic}} for the reader.');
      expect(onFieldChange).toHaveBeenCalledWith('version_details.variables', [{ name: 'topic', value: '' }]);
    });

    it('keeps the value already typed for a placeholder that is still used', () => {
      const onFieldChange = vi.fn();
      const { result } = renderHookWithProviders(() =>
        useCreateAgentFormState(
          { name: 'a', version_details: { instructions: 'About {{topic}}', variables: [{ name: 'topic', value: 'weather' }] } },
          onFieldChange,
        ),
      );
      act(() => {
        result.current.onInstructionsChange('About {{topic}}, briefly, mentioning {{tone}}.');
      });
      expect(onFieldChange).toHaveBeenCalledWith('version_details.variables', [
        { name: 'tone', value: '' },
        { name: 'topic', value: 'weather' },
      ]);
    });

    it('drops the row when its placeholder is deleted — including one that already had a value (baseline: no confirmation, wholesale replace)', () => {
      const onFieldChange = vi.fn();
      const { result } = renderHookWithProviders(() =>
        useCreateAgentFormState(
          {
            name: 'a',
            version_details: {
              instructions: 'About {{topic}} and {{tone}}',
              variables: [
                { name: 'tone', value: 'dry' },
                { name: 'topic', value: '' },
              ],
            },
          },
          onFieldChange,
        ),
      );
      act(() => {
        result.current.onInstructionsChange('About {{topic}} only.');
      });
      expect(onFieldChange).toHaveBeenCalledWith('version_details.variables', [{ name: 'topic', value: '' }]);
    });

    it('de-duplicates repeated placeholders and sorts the rows, matching contextResolver', () => {
      const onFieldChange = vi.fn();
      const { result } = renderHookWithProviders(() =>
        useCreateAgentFormState({ name: 'a', version_details: { variables: [] } }, onFieldChange),
      );
      act(() => {
        result.current.onInstructionsChange('{{zebra}} {{apple}} {{zebra}} {{ apple }}');
      });
      expect(onFieldChange).toHaveBeenCalledWith('version_details.variables', [
        { name: 'apple', value: '' },
        { name: 'zebra', value: '' },
      ]);
    });

    it('emits no variables write at all when the edit changes no placeholder (the create pages\' unsaved-changes guard must not arm)', () => {
      const onFieldChange = vi.fn();
      const { result } = renderHookWithProviders(() =>
        useCreateAgentFormState(
          { name: 'a', version_details: { instructions: 'About {{topic}}', variables: [{ name: 'topic', value: 'weather' }] } },
          onFieldChange,
        ),
      );
      act(() => {
        result.current.onInstructionsChange('About {{topic}}!');
      });
      expect(onFieldChange).toHaveBeenCalledTimes(1);
      expect(onFieldChange).toHaveBeenCalledWith('version_details.instructions', 'About {{topic}}!');
    });

    it('clears every row once the last placeholder is gone', () => {
      const onFieldChange = vi.fn();
      const { result } = renderHookWithProviders(() =>
        useCreateAgentFormState(
          { name: 'a', version_details: { instructions: 'About {{topic}}', variables: [{ name: 'topic', value: 'weather' }] } },
          onFieldChange,
        ),
      );
      act(() => {
        result.current.onInstructionsChange('About the weather.');
      });
      expect(onFieldChange).toHaveBeenCalledWith('version_details.variables', []);
    });
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
