import { describe, expect, it } from 'vitest';

import {
  computeSecurePath,
  ensureTrailingSlash,
  validateFileName,
  validateFolderPath,
} from './pathValidation';

describe('artifact path validation', () => {
  it('accepts safe relative paths and composes them with the current prefix', () => {
    expect(validateFolderPath('reports/2026-Q3', 'team/')).toBe('');
    expect(computeSecurePath('reports/2026-Q3/', 'team/')).toBe('team/reports/2026-Q3');
    expect(computeSecurePath('', 'team/')).toBe('team');
  });

  it.each([
    ['../secret', 'forbidden pattern'],
    ['~/secret', 'forbidden pattern'],
    ['folder\\child', 'forbidden character'],
    ['/absolute', 'Absolute paths'],
    ['one//two', 'consecutive separators'],
    ['one/two/three/four/five/six/seven/eight/nine/ten/eleven', 'Maximum folder depth'],
    ['.', 'not allowed'],
    ['bad space', 'invalid characters'],
    ['bad:name', 'forbidden character'],
  ])('rejects unsafe folder path %s', (path, message) => {
    expect(validateFolderPath(path)).toContain(message);
    expect(() => computeSecurePath(path)).toThrow();
  });

  it('accounts for the existing prefix in the maximum depth', () => {
    expect(validateFolderPath('nine/ten', 'one/two/three/four/five/six/seven/eight/')).toBe('');
    expect(validateFolderPath('nine/ten/eleven', 'one/two/three/four/five/six/seven/eight/')).toContain('Maximum');
  });

  it.each([
    ['', 'empty'],
    ['two..dots.txt', 'consecutive dots'],
    ['hash#.txt', '"#"'],
    ['folder/file.txt', '"/"'],
  ])('rejects unsafe filename %s', (name, message) => {
    expect(validateFileName(name)).toContain(message);
  });

  it('accepts ordinary filenames and normalizes trailing slashes', () => {
    expect(validateFileName('Q3 report (final).pdf')).toBe('');
    expect(ensureTrailingSlash('folder')).toBe('folder/');
    expect(ensureTrailingSlash('folder/')).toBe('folder/');
    expect(ensureTrailingSlash('')).toBe('');
  });
});
