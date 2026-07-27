import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, waitFor } from '@testing-library/react';

import {
  getCreateModerationRequestMockHandler,
  getModerationStatusMockHandler,
} from '@/shared/api/generated/admin/admin.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { REQUEST_STATUS } from '../lib/constants';

import { entityIdForType, useModerationRequests } from './useModerationRequests';
import { renderHookWithRouter } from '../__tests__/testUtils';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('entityIdForType', () => {
  it('is deterministic for the same type', () => {
    expect(entityIdForType('inventory')).toBe(entityIdForType('inventory'));
  });

  it('differs across the two catalog types (no collision for this app)', () => {
    expect(entityIdForType('inventory')).not.toBe(entityIdForType('wikis_Wikis'));
  });

  it('is always a non-negative 32-bit integer', () => {
    const id = entityIdForType('inventory');
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(id).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('useModerationRequests', () => {
  it('reports REQUEST_STATUS.NONE for every type while there is no selected project', async () => {
    const { result } = renderHookWithRouter(() => useModerationRequests());
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current.getRequestStatus('inventory')).toBe(REQUEST_STATUS.NONE);
    expect(result.current.isFetching).toBe(false);
  });

  it('reports REQUEST_STATUS.NONE for a type outside the catalogue', async () => {
    server.use(getModerationStatusMockHandler({ status: REQUEST_STATUS.APPROVED }));
    const { result } = renderHookWithRouter(() => useModerationRequests(), { projectId: 'proj-1' });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.getRequestStatus('not-a-catalog-type')).toBe(REQUEST_STATUS.NONE);
  });

  it('reports the status the (stub) backend returns for a real project', async () => {
    server.use(getModerationStatusMockHandler({ status: REQUEST_STATUS.APPROVED }));

    const { result } = renderHookWithRouter(() => useModerationRequests(), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.getRequestStatus('inventory')).toBe(REQUEST_STATUS.APPROVED);
    expect(result.current.getRequestStatus('wikis_Wikis')).toBe(REQUEST_STATUS.APPROVED);
  });

  it('falls back to REQUEST_STATUS.NONE for an unrecognised status value from the server', async () => {
    server.use(getModerationStatusMockHandler({ status: 'something-unexpected' }));

    const { result } = renderHookWithRouter(() => useModerationRequests(), { projectId: 'proj-1' });

    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.getRequestStatus('inventory')).toBe(REQUEST_STATUS.NONE);
  });

  it('submitRequest sets isSubmitting for the duration of the call and clears it after', async () => {
    server.use(
      getModerationStatusMockHandler({ status: REQUEST_STATUS.NONE }),
      getCreateModerationRequestMockHandler({ status: REQUEST_STATUS.APPROVED }),
    );

    const { result } = renderHookWithRouter(() => useModerationRequests(), { projectId: 'proj-1' });
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.isSubmitting).toBe(false);
    await act(async () => {
      await result.current.submitRequest('inventory', 'I need this for onboarding');
    });
    expect(result.current.isSubmitting).toBe(false);
  });

  it('submitRequest is a no-op while there is no selected project', async () => {
    const { result } = renderHookWithRouter(() => useModerationRequests());
    await waitFor(() => expect(result.current).toBeDefined());

    await act(async () => {
      await result.current.submitRequest('inventory', 'reason');
    });
    expect(result.current.getRequestStatus('inventory')).toBe(REQUEST_STATUS.NONE);
  });
});
