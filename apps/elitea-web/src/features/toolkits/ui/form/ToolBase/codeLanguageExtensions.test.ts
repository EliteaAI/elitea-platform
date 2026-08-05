import { describe, expect, it } from 'vitest';

import { getCodeLanguageExtensions } from './codeLanguageExtensions';

describe('getCodeLanguageExtensions', () => {
  it('returns a non-empty extension list for json', () => {
    const extensions = getCodeLanguageExtensions('json');
    expect(extensions.length).toBeGreaterThan(0);
  });

  it('returns an empty extension list for an unsupported language (disclosed gap)', () => {
    expect(getCodeLanguageExtensions('python')).toEqual([]);
  });

  it('returns an empty extension list for undefined', () => {
    expect(getCodeLanguageExtensions(undefined)).toEqual([]);
  });
});
