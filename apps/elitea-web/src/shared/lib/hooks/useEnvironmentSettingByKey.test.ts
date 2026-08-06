import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_PARTICIPANT_NAME,
  DEFAULT_TOAST_DURATION,
  ENVIRONMENT_KEYS,
  useEnvironmentSettingByKey,
  useErrorToastDuration,
  useSystemSenderName,
} from './useEnvironmentSettingByKey';

const mockGetConfig = vi.fn();

vi.mock('@/shared/config', () => ({
  getConfig: () => mockGetConfig(),
}));

describe('useEnvironmentSettingByKey', () => {
  it('returns value from config when key exists', () => {
    mockGetConfig.mockReturnValue({
      status: 'ok',
      config: { system_sender_name: 'Bot', error_toast_duration: '3000' },
    });
    const { result } = renderHook(() => useEnvironmentSettingByKey('system_sender_name'));
    expect(result.current.value).toBe('Bot');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns null when key does not exist in config', () => {
    mockGetConfig.mockReturnValue({ status: 'ok', config: {} });
    const { result } = renderHook(() => useEnvironmentSettingByKey('nonexistent'));
    expect(result.current.value).toBeNull();
  });

  it('returns null when key is null', () => {
    mockGetConfig.mockReturnValue({ status: 'ok', config: { x: 'val' } });
    const { result } = renderHook(() => useEnvironmentSettingByKey(null));
    expect(result.current.value).toBeNull();
  });

  it('returns null when key is undefined', () => {
    mockGetConfig.mockReturnValue({ status: 'ok', config: { x: 'val' } });
    const { result } = renderHook(() => useEnvironmentSettingByKey(undefined));
    expect(result.current.value).toBeNull();
  });

  it('returns null when key is empty string', () => {
    mockGetConfig.mockReturnValue({ status: 'ok', config: { '': 'val' } });
    const { result } = renderHook(() => useEnvironmentSettingByKey(''));
    expect(result.current.value).toBeNull();
  });

  it('returns null when config status is missing', () => {
    mockGetConfig.mockReturnValue({ status: 'missing', missing: ['x'], reasons: {} });
    const { result } = renderHook(() => useEnvironmentSettingByKey('system_sender_name'));
    expect(result.current.value).toBeNull();
  });

  it('returns null when config value is not a string', () => {
    mockGetConfig.mockReturnValue({ status: 'ok', config: { key: 42 } });
    const { result } = renderHook(() => useEnvironmentSettingByKey('key'));
    expect(result.current.value).toBeNull();
  });
});

describe('useSystemSenderName', () => {
  it('returns system_sender_name from config', () => {
    mockGetConfig.mockReturnValue({
      status: 'ok',
      config: { [ENVIRONMENT_KEYS.SYSTEM_SENDER_NAME]: 'Elitea' },
    });
    const { result } = renderHook(() => useSystemSenderName());
    expect(result.current).toBe('Elitea');
  });

  it('returns DEFAULT_PARTICIPANT_NAME when key is absent', () => {
    mockGetConfig.mockReturnValue({ status: 'ok', config: {} });
    const { result } = renderHook(() => useSystemSenderName());
    expect(result.current).toBe(DEFAULT_PARTICIPANT_NAME);
  });
});

describe('useErrorToastDuration', () => {
  it('returns parsed integer from config', () => {
    mockGetConfig.mockReturnValue({
      status: 'ok',
      config: { [ENVIRONMENT_KEYS.ERROR_TOAST_DURATION]: '3000' },
    });
    const { result } = renderHook(() => useErrorToastDuration());
    expect(result.current).toBe(3000);
  });

  it('returns DEFAULT_TOAST_DURATION when key is absent', () => {
    mockGetConfig.mockReturnValue({ status: 'ok', config: {} });
    const { result } = renderHook(() => useErrorToastDuration());
    expect(result.current).toBe(DEFAULT_TOAST_DURATION);
  });

  it('returns NaN for non-numeric string (parseInt passthrough)', () => {
    mockGetConfig.mockReturnValue({
      status: 'ok',
      config: { [ENVIRONMENT_KEYS.ERROR_TOAST_DURATION]: 'abc' },
    });
    const { result } = renderHook(() => useErrorToastDuration());
    expect(result.current).toBeNaN();
  });
});
