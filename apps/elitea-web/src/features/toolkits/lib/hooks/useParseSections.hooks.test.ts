import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useParseSections } from './useParseSections.hooks';

describe('useParseSections', () => {
  it('returns empty sections/sectionProps for an undefined schema', () => {
    const { result } = renderHook(() => useParseSections(undefined));
    expect(result.current.sections).toEqual({});
    expect(result.current.sectionProps).toEqual([]);
  });

  it('flattens every subsection field across every section into sectionProps', () => {
    const schema = {
      metadata: {
        sections: {
          auth: { subsections: [{ fields: ['token'] }, { fields: ['username', 'password'] }] },
          advanced: { subsections: [{ fields: ['timeout'] }] },
        },
      },
    };
    const { result } = renderHook(() => useParseSections(schema));
    expect(result.current.sections).toBe(schema.metadata.sections);
    expect(result.current.sectionProps).toEqual(['token', 'username', 'password', 'timeout']);
  });

  it('handles a section with no subsections', () => {
    const schema = { metadata: { sections: { empty: {} } } };
    const { result } = renderHook(() => useParseSections(schema));
    expect(result.current.sectionProps).toEqual([]);
  });

  it('memoises across re-renders with the same sections reference', () => {
    const schema = { metadata: { sections: { a: { subsections: [{ fields: ['x'] }] } } } };
    const { result, rerender } = renderHook(({ s }) => useParseSections(s), { initialProps: { s: schema } });
    const first = result.current;
    rerender({ s: schema });
    expect(result.current).toBe(first);
  });
});
