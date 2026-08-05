import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { VersionSummary } from '@/entities/version';

import { useIsVersionNotFound } from './useIsVersionNotFound';

const VERSIONS: readonly VersionSummary[] = [
  { id: '1', name: 'base', status: 'draft', agentType: 'pipeline', createdAt: '2026-01-01T00:00:00Z' },
  { id: '2', name: 'v2', status: 'published', agentType: 'pipeline', createdAt: '2026-01-02T00:00:00Z' },
];

describe('useIsVersionNotFound', () => {
  it('returns false while skip is true, regardless of everything else', () => {
    const { result } = renderHook(() =>
      useIsVersionNotFound({ version: 'missing', isFetching: false, isError: false, versions: VERSIONS, skip: true }),
    );
    expect(result.current).toBe(false);
  });

  it('returns false when version is undefined', () => {
    const { result } = renderHook(() =>
      useIsVersionNotFound({ version: undefined, isFetching: false, isError: false, versions: VERSIONS }),
    );
    expect(result.current).toBe(false);
  });

  it('returns false while still fetching', () => {
    const { result } = renderHook(() =>
      useIsVersionNotFound({ version: 'missing', isFetching: true, isError: false, versions: VERSIONS }),
    );
    expect(result.current).toBe(false);
  });

  it('returns false on a fetch error (avoids flashing 404 on a transient error)', () => {
    const { result } = renderHook(() =>
      useIsVersionNotFound({ version: 'missing', isFetching: false, isError: true, versions: VERSIONS }),
    );
    expect(result.current).toBe(false);
  });

  it('returns false when versions has not loaded yet', () => {
    const { result } = renderHook(() =>
      useIsVersionNotFound({ version: '1', isFetching: false, isError: false, versions: undefined }),
    );
    expect(result.current).toBe(false);
  });

  it('returns false when the version id is present (string-compared)', () => {
    const { result } = renderHook(() =>
      useIsVersionNotFound({ version: '2', isFetching: false, isError: false, versions: VERSIONS }),
    );
    expect(result.current).toBe(false);
  });

  it('returns true when the version id is absent from a loaded, non-empty version list', () => {
    const { result } = renderHook(() =>
      useIsVersionNotFound({ version: '999', isFetching: false, isError: false, versions: VERSIONS }),
    );
    expect(result.current).toBe(true);
  });
});
