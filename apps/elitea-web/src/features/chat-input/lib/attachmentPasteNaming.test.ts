import { describe, expect, it } from 'vitest';

import { generateRandomAppendix, renameFile } from './attachmentPasteNaming';

describe('generateRandomAppendix', () => {
  it('formats YYYYMMDD_HHMMSS_<sizeKB>KB', () => {
    const appendix = generateRandomAppendix(2048);
    expect(appendix).toMatch(/^\d{8}_\d{6}_2\.00KB$/);
  });
});

describe('renameFile', () => {
  it('inserts the appendix before the extension', () => {
    const file = new File(['x'], 'photo.png', { type: 'image/png', lastModified: 123 });
    const renamed = renameFile(file, 'abc');
    expect(renamed.name).toBe('photo_abc.png');
    expect(renamed.type).toBe('image/png');
    expect(renamed.lastModified).toBe(123);
  });

  it('appends the appendix when the file has no extension', () => {
    const file = new File(['x'], 'README');
    const renamed = renameFile(file, 'abc');
    expect(renamed.name).toBe('README_abc');
  });
});
