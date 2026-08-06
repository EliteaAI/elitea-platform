import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFormikAutoSaveOnBlur } from './useFormikAutoSaveOnBlur';

const mockSubmitForm = vi.fn().mockResolvedValue(undefined);
const mockValidateForm = vi.fn().mockResolvedValue({});

const formikDefaults = {
  dirty: true,
  isValidating: false,
  isSubmitting: false,
  submitForm: mockSubmitForm,
  validateForm: mockValidateForm,
};

let formikState = { ...formikDefaults };

vi.mock('formik', () => ({
  useFormikContext: () => formikState,
}));

function makeBlurEvent(tagName: string): React.FocusEvent {
  return { target: { tagName: tagName.toUpperCase() } } as unknown as React.FocusEvent;
}

describe('useFormikAutoSaveOnBlur', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    formikState = { ...formikDefaults };
    mockSubmitForm.mockClear();
    mockValidateForm.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('submits after blur on an input element with debounce', async () => {
    const { result } = renderHook(() => useFormikAutoSaveOnBlur());

    act(() => {
      result.current.onBlur(makeBlurEvent('input'));
    });

    expect(mockSubmitForm).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(mockValidateForm).toHaveBeenCalledTimes(1);
    expect(mockSubmitForm).toHaveBeenCalledTimes(1);
  });

  it('ignores blur from non-input elements (div, button)', () => {
    const { result } = renderHook(() => useFormikAutoSaveOnBlur());

    act(() => {
      result.current.onBlur(makeBlurEvent('div'));
      result.current.onBlur(makeBlurEvent('button'));
    });

    vi.advanceTimersByTime(500);
    expect(mockSubmitForm).not.toHaveBeenCalled();
  });

  it('triggers on textarea and select elements', async () => {
    const { result } = renderHook(() => useFormikAutoSaveOnBlur());

    act(() => {
      result.current.onBlur(makeBlurEvent('textarea'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(mockSubmitForm).toHaveBeenCalledTimes(1);

    mockSubmitForm.mockClear();
    mockValidateForm.mockClear();

    act(() => {
      result.current.onBlur(makeBlurEvent('select'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(mockSubmitForm).toHaveBeenCalledTimes(1);
  });

  it('does not submit when form is not dirty', async () => {
    formikState = { ...formikDefaults, dirty: false };
    const { result } = renderHook(() => useFormikAutoSaveOnBlur());

    act(() => {
      result.current.onBlur(makeBlurEvent('input'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(mockSubmitForm).not.toHaveBeenCalled();
  });

  it('does not submit when already submitting', async () => {
    formikState = { ...formikDefaults, isSubmitting: true };
    const { result } = renderHook(() => useFormikAutoSaveOnBlur());

    act(() => {
      result.current.onBlur(makeBlurEvent('input'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(mockSubmitForm).not.toHaveBeenCalled();
  });

  it('does not submit when validating', async () => {
    formikState = { ...formikDefaults, isValidating: true };
    const { result } = renderHook(() => useFormikAutoSaveOnBlur());

    act(() => {
      result.current.onBlur(makeBlurEvent('input'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(mockSubmitForm).not.toHaveBeenCalled();
  });

  it('does not submit when disabled', async () => {
    const { result } = renderHook(() => useFormikAutoSaveOnBlur({ isEnabled: false }));

    act(() => {
      result.current.onBlur(makeBlurEvent('input'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(mockSubmitForm).not.toHaveBeenCalled();
  });

  it('skips submit when validation returns errors', async () => {
    mockValidateForm.mockResolvedValueOnce({ name: 'Required' });
    const { result } = renderHook(() => useFormikAutoSaveOnBlur());

    act(() => {
      result.current.onBlur(makeBlurEvent('input'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(mockValidateForm).toHaveBeenCalled();
    expect(mockSubmitForm).not.toHaveBeenCalled();
  });

  it('debounces multiple rapid blurs into a single submit', async () => {
    const { result } = renderHook(() => useFormikAutoSaveOnBlur());

    act(() => {
      result.current.onBlur(makeBlurEvent('input'));
    });
    vi.advanceTimersByTime(100);
    act(() => {
      result.current.onBlur(makeBlurEvent('input'));
    });
    vi.advanceTimersByTime(100);
    act(() => {
      result.current.onBlur(makeBlurEvent('input'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(mockSubmitForm).toHaveBeenCalledTimes(1);
  });

  it('requestSubmit() triggers submit directly', async () => {
    const { result } = renderHook(() => useFormikAutoSaveOnBlur());

    act(() => {
      result.current.requestSubmit();
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(mockSubmitForm).toHaveBeenCalledTimes(1);
  });

  it('respects custom debounce interval', async () => {
    const { result } = renderHook(() => useFormikAutoSaveOnBlur({ debounceMs: 500 }));

    act(() => {
      result.current.onBlur(makeBlurEvent('input'));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(mockSubmitForm).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(mockSubmitForm).toHaveBeenCalledTimes(1);
  });
});
