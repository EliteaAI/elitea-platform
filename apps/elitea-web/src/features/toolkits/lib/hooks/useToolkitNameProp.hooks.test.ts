import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useToolkitNameProp } from './useToolkitNameProp.hooks';

describe('useToolkitNameProp', () => {
  it('resolves the schema property flagged toolkit_name', () => {
    const schemaOfTools = { github: { properties: { repo_name: { toolkit_name: true } } } };
    const { result } = renderHook(() => useToolkitNameProp('github', schemaOfTools));
    expect(result.current.toolkitNameProp).toBe('repo_name');
  });

  it('resolves undefined toolkitNameProp when no property is flagged', () => {
    const { result } = renderHook(() => useToolkitNameProp('github', { github: { properties: {} } }));
    expect(result.current.toolkitNameProp).toBeUndefined();
  });

  it('defaults nameIsRequired to true when name_required is absent', () => {
    const { result } = renderHook(() => useToolkitNameProp('github', {}));
    expect(result.current.nameIsRequired).toBe(true);
  });

  it('nameIsRequired is false only when name_required is explicitly false', () => {
    const { result } = renderHook(() => useToolkitNameProp('github', { github: { name_required: false } }));
    expect(result.current.nameIsRequired).toBe(false);
  });

  it('descriptionIsRequired is true when "description" is in the required array', () => {
    const { result } = renderHook(() => useToolkitNameProp('github', { github: { required: ['description'] } }));
    expect(result.current.descriptionIsRequired).toBe(true);
  });

  it('descriptionIsRequired is falsy when required is absent or does not include description', () => {
    const { result: r1 } = renderHook(() => useToolkitNameProp('github', {}));
    expect(r1.current.descriptionIsRequired).toBeUndefined();

    const { result: r2 } = renderHook(() => useToolkitNameProp('github', { github: { required: ['other'] } }));
    expect(r2.current.descriptionIsRequired).toBe(false);
  });

  it('returns the same schemaOfTools reference passed in', () => {
    const schemaOfTools = { github: {} };
    const { result } = renderHook(() => useToolkitNameProp('github', schemaOfTools));
    expect(result.current.schemaOfTools).toBe(schemaOfTools);
  });
});
