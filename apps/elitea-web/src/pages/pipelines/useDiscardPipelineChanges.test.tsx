import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormProvider, useForm } from 'react-hook-form';

import { useDiscardPipelineChanges } from './useDiscardPipelineChanges';

interface FormValues {
  readonly name: string;
}

describe('useDiscardPipelineChanges', () => {
  it('resets the surrounding form back to its default values', () => {
    let getName: (() => string) | undefined;
    let setName: ((value: string) => void) | undefined;
    let discardChanges: (() => void) | undefined;

    function Harness() {
      const form = useForm<FormValues>({ defaultValues: { name: 'Saved Name' } });
      getName = () => form.getValues('name');
      setName = (value: string) => {
        form.setValue('name', value);
      };
      return (
        <FormProvider {...form}>
          <Consumer />
        </FormProvider>
      );
    }

    function Consumer() {
      const { discardPipelineChanges } = useDiscardPipelineChanges();
      discardChanges = discardPipelineChanges;
      return null;
    }

    renderHook(() => null, { wrapper: Harness });

    act(() => {
      setName?.('Edited Name');
    });
    expect(getName?.()).toBe('Edited Name');

    act(() => {
      discardChanges?.();
    });
    expect(getName?.()).toBe('Saved Name');
  });

  it('calls doOtherResets after resetting the form', () => {
    const calls: string[] = [];
    let discardChanges: (() => void) | undefined;

    function Harness() {
      const form = useForm<FormValues>({ defaultValues: { name: 'Saved Name' } });
      return (
        <FormProvider {...form}>
          <Consumer />
        </FormProvider>
      );
    }

    function Consumer() {
      const { discardPipelineChanges } = useDiscardPipelineChanges(() => {
        calls.push('doOtherResets');
      });
      discardChanges = discardPipelineChanges;
      return null;
    }

    renderHook(() => null, { wrapper: Harness });

    act(() => {
      discardChanges?.();
    });
    expect(calls).toEqual(['doOtherResets']);
  });

  it('does not throw when doOtherResets is omitted', () => {
    let discardChanges: (() => void) | undefined;

    function Harness() {
      const form = useForm<FormValues>({ defaultValues: { name: 'Saved Name' } });
      return (
        <FormProvider {...form}>
          <Consumer />
        </FormProvider>
      );
    }

    function Consumer() {
      const { discardPipelineChanges } = useDiscardPipelineChanges();
      discardChanges = discardPipelineChanges;
      return null;
    }

    renderHook(() => null, { wrapper: Harness });

    expect(() => {
      act(() => {
        discardChanges?.();
      });
    }).not.toThrow();
  });
});
