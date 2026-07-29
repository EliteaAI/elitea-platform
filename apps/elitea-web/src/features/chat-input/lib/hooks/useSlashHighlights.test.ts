import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSlashHighlights } from './useSlashHighlights';
import type { CommittedToolkitMention } from './useSlashCommandHandler.types';

function mention(overrides: Partial<CommittedToolkitMention> & Pick<CommittedToolkitMention, 'toolkitName'>): CommittedToolkitMention {
  return { toolkitId: 'tk-1', projectId: 'p-1', toolkitType: 'github', toolName: null, ...overrides };
}

describe('useSlashHighlights', () => {
  it('returns [] when there are no committed mentions or no input', () => {
    expect(renderHook(() => useSlashHighlights('', [])).result.current).toEqual([]);
    expect(renderHook(() => useSlashHighlights('/github', [])).result.current).toEqual([]);
    expect(renderHook(() => useSlashHighlights('', [mention({ toolkitName: 'github' })])).result.current).toEqual([]);
  });

  it('highlights a toolkit-only mention token', () => {
    const { result } = renderHook(() => useSlashHighlights('/github hello', [mention({ toolkitName: 'github' })]));
    expect(result.current).toEqual([{ start: 0, end: 7 }]);
  });

  it('highlights a toolkit/tool mention token', () => {
    const { result } = renderHook(() =>
      useSlashHighlights('/github/create_issue hello', [mention({ toolkitName: 'github', toolName: 'create_issue' })]),
    );
    expect(result.current).toEqual([{ start: 0, end: 20 }]);
  });

  it('longer tokens are checked first so /toolkit/tool shadows /toolkit at the same position', () => {
    const { result } = renderHook(() =>
      useSlashHighlights('/github/create_issue', [mention({ toolkitName: 'github' }), mention({ toolkitName: 'github', toolName: 'create_issue' })]),
    );
    expect(result.current).toEqual([{ start: 0, end: 20 }]);
  });

  it('finds multiple non-overlapping tokens', () => {
    const { result } = renderHook(() =>
      useSlashHighlights('/github and /jira', [mention({ toolkitName: 'github' }), mention({ toolkitId: 'tk-2', toolkitName: 'jira' })]),
    );
    expect(result.current).toEqual([
      { start: 0, end: 7 },
      { start: 12, end: 17 },
    ]);
  });

  it('deduplicates identical tokens from multiple committed mentions', () => {
    const { result } = renderHook(() => useSlashHighlights('/github', [mention({ toolkitName: 'github' }), mention({ toolkitName: 'github' })]));
    expect(result.current).toEqual([{ start: 0, end: 7 }]);
  });
});
