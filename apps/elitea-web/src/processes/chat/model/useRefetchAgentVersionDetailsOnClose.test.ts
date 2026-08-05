import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useApplicationsStore } from '@/features/agents';

import { useRefetchAgentVersionDetailsOnClose } from './useRefetchAgentVersionDetailsOnClose';

describe('useRefetchAgentVersionDetailsOnClose', () => {
  afterEach(() => {
    useApplicationsStore.setState({ shouldRefetchDetails: false });
  });

  it('does nothing when shouldRefetchDetails is false', () => {
    const refetchVersionDetails = vi.fn();
    const { result } = renderHook(() => useRefetchAgentVersionDetailsOnClose({ refetchVersionDetails }));

    act(() => result.current.refetchAgentVersionDetailsOnClose());

    expect(refetchVersionDetails).not.toHaveBeenCalled();
  });

  it('refetches and clears the flag when shouldRefetchDetails is true', () => {
    useApplicationsStore.setState({ shouldRefetchDetails: true });
    const refetchVersionDetails = vi.fn();
    const { result } = renderHook(() => useRefetchAgentVersionDetailsOnClose({ refetchVersionDetails }));

    act(() => result.current.refetchAgentVersionDetailsOnClose());

    expect(refetchVersionDetails).toHaveBeenCalledTimes(1);
    expect(useApplicationsStore.getState().shouldRefetchDetails).toBe(false);
  });

  it('is safe when refetchVersionDetails is not supplied', () => {
    useApplicationsStore.setState({ shouldRefetchDetails: true });
    const { result } = renderHook(() => useRefetchAgentVersionDetailsOnClose({}));

    expect(() => act(() => result.current.refetchAgentVersionDetailsOnClose())).not.toThrow();
    expect(useApplicationsStore.getState().shouldRefetchDetails).toBe(false);
  });
});
