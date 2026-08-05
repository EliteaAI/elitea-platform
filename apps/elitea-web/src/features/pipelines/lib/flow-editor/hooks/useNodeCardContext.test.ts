import { createElement } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NodeCardContext } from '../flowEditorContext';
import { useNodeCardContext } from './useNodeCardContext';

describe('useNodeCardContext', () => {
  it('returns undefined outside a NodeCardContext.Provider', () => {
    const { result } = renderHook(() => useNodeCardContext());
    expect(result.current).toBeUndefined();
  });

  it('returns the provided { isExpanded } value inside a Provider', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(NodeCardContext.Provider, { value: { isExpanded: true } }, children);

    const { result } = renderHook(() => useNodeCardContext(), { wrapper });
    expect(result.current).toEqual({ isExpanded: true });
  });
});
