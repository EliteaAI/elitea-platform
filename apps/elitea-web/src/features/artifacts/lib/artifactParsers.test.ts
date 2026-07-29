import { describe, expect, it } from 'vitest';

import { artifactPreviewKind, parseDataFile } from './artifactParsers';

describe('artifact parsers', () => {
  it('parses quoted CSV values, escaped quotes, and line endings', () => {
    expect(parseDataFile('name,note\r\nAlice,"hello, world"\r\nBob,"said ""yes"""', 'csv')).toEqual({
      headers: ['name', 'note'],
      rows: [
        ['Alice', 'hello, world'],
        ['Bob', 'said "yes"'],
      ],
    });
  });

  it('parses TSV and empty content', () => {
    expect(parseDataFile('name\tage\nAda\t36', 'tsv')).toEqual({
      headers: ['name', 'age'],
      rows: [['Ada', '36']],
    });
    expect(parseDataFile('  ', 'csv')).toEqual({ headers: [], rows: [] });
  });

  it.each([
    ['README.md', 'markdown'],
    ['table.csv', 'csv'],
    ['table.tsv', 'tsv'],
    ['flow.mmd', 'mermaid'],
    ['photo.PNG', 'image'],
    ['data.json', 'text'],
    ['report.docx', 'docx'],
    ['archive.zip', 'unsupported'],
    ['LICENSE', 'unsupported'],
  ] as const)('classifies %s as %s', (filename, expected) => {
    expect(artifactPreviewKind(filename)).toBe(expected);
  });
});
