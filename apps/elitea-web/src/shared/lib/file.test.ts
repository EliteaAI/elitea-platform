import { describe, expect, it } from 'vitest';

import { getFileFormat } from './file';

describe('getFileFormat', () => {
  it.each([
    ['report.pdf', 'pdf'],
    ['archive.tar.gz', 'gz'],
    ['data.YML', 'yaml'],
    ['data.yaml', 'yaml'],
    ['data.YAML', 'yaml'],
    ['README', 'readme'],
    ['.gitignore', 'gitignore'],
  ])('getFileFormat(%j) -> %j', (input, expected) => {
    expect(getFileFormat(input)).toBe(expected);
  });
});
