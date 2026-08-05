import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { installWebStorageShim } from '../../../test/webstorage';

import { loadSoundConfig } from './soundNotification';
import { useSoundNotification } from './useSoundNotification';

installWebStorageShim();

beforeEach(() => {
  window.localStorage.clear();
});

describe('useSoundNotification', () => {
  it('initializes config from storage', () => {
    const { result } = renderHook(() => useSoundNotification());
    expect(result.current.config).toEqual({ enabled: true, volume: 0.5 });
  });

  it('setConfig merges updates, persists, and re-renders with the new value', () => {
    const { result } = renderHook(() => useSoundNotification());
    act(() => {
      result.current.setConfig({ enabled: false });
    });
    expect(result.current.config).toEqual({ enabled: false, volume: 0.5 });
    expect(loadSoundConfig()).toEqual({ enabled: false, volume: 0.5 });
  });

  it('setConfig is a partial merge — an earlier field survives a later unrelated update', () => {
    const { result } = renderHook(() => useSoundNotification());
    act(() => {
      result.current.setConfig({ volume: 0.9 });
    });
    act(() => {
      result.current.setConfig({ enabled: false });
    });
    expect(result.current.config).toEqual({ enabled: false, volume: 0.9 });
  });

  it('exposes playCompletionSound/playErrorSound (fire without throwing)', () => {
    const { result } = renderHook(() => useSoundNotification());
    expect(() => {
      result.current.playCompletionSound();
      result.current.playErrorSound();
    }).not.toThrow();
  });
});
