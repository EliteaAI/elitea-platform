import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useCorrectUserNameInUrl } from './useCorrectUserNameInUrl';

const ORIGINAL_URL = window.location.href;

beforeEach(() => {
  window.history.replaceState(null, '', '/agents/latest/42');
});

afterEach(() => {
  window.history.replaceState(null, '', ORIGINAL_URL);
});

describe('useCorrectUserNameInUrl', () => {
  it('does nothing when realName is undefined', () => {
    renderHook(() => useCorrectUserNameInUrl(undefined));
    expect(window.location.search).toBe('');
  });

  it('does nothing when realName is an empty string', () => {
    renderHook(() => useCorrectUserNameInUrl(''));
    expect(window.location.search).toBe('');
  });

  it('sets ?name= to the real name when absent from the URL', () => {
    renderHook(() => useCorrectUserNameInUrl('My Agent'));
    expect(new URL(window.location.href).searchParams.get('name')).toBe('My Agent');
  });

  it('is a no-op (does not touch history) when the URL already matches', () => {
    window.history.replaceState(null, '', '/agents/latest/42?name=My+Agent');
    const before = window.location.href;
    renderHook(() => useCorrectUserNameInUrl('My Agent'));
    expect(window.location.href).toBe(before);
  });

  it('re-syncs when realName changes on a rerender', () => {
    const { rerender } = renderHook(({ name }: { name: string }) => useCorrectUserNameInUrl(name), {
      initialProps: { name: 'First' },
    });
    expect(new URL(window.location.href).searchParams.get('name')).toBe('First');

    rerender({ name: 'Second' });
    expect(new URL(window.location.href).searchParams.get('name')).toBe('Second');
  });
});
