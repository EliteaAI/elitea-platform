import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useNodeAiAssistantConfig } from './useNodeAiAssistantConfig';

describe('useNodeAiAssistantConfig', () => {
  it('passes through a defined llm_settings value', () => {
    const settings = { model: 'gpt-4o' };
    const { result } = renderHook(() => useNodeAiAssistantConfig(settings));
    expect(result.current).toBe(settings);
  });

  it('normalises undefined to null', () => {
    const { result } = renderHook(() => useNodeAiAssistantConfig(undefined));
    expect(result.current).toBeNull();
  });

  it('normalises null to null', () => {
    const { result } = renderHook(() => useNodeAiAssistantConfig(null));
    expect(result.current).toBeNull();
  });
});
