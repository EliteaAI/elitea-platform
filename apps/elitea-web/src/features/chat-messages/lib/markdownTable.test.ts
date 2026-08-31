/**
 * The load-bearing property of the canvas table editor: a table must survive
 * parse → edit → serialise unchanged. The cell that breaks a naive
 * implementation is one containing a `|`, because that is the column
 * separator — the escape (`\|`) and the un-escape have to agree, in both
 * directions, and the backslash escape has to be applied BEFORE the pipe
 * escape or the second pass re-escapes the first pass's own backslash.
 */
import { describe, expect, it } from 'vitest';

import { parseDelimitedText, parseMarkdownTable, serialiseMarkdownTable } from './markdownTable';

describe('parseMarkdownTable / serialiseMarkdownTable', () => {
  it('round-trips a cell containing a pipe character without corrupting it', () => {
    const original = '| Name | Expression |\n| --- | --- |\n| or | a \\| b |\n';

    const parsed = parseMarkdownTable(original);
    expect(parsed.headers).toEqual(['Name', 'Expression']);
    expect(parsed.rows).toEqual([['or', 'a | b']]);

    // Edit one cell — the pipe stays inside it — then serialise and re-parse.
    const edited = { headers: parsed.headers, rows: [['or', 'x | y | z']] };
    const markdown = serialiseMarkdownTable(edited);
    expect(parseMarkdownTable(markdown).rows).toEqual([['or', 'x | y | z']]);
  });

  it('round-trips a cell containing a backslash next to a pipe', () => {
    const data = { headers: ['a'], rows: [['C:\\path | D:\\other']] };
    expect(parseMarkdownTable(serialiseMarkdownTable(data)).rows).toEqual([['C:\\path | D:\\other']]);
  });

  it('round-trips a multi-line cell through the <br> encoding', () => {
    const data = { headers: ['note'], rows: [['first\nsecond']] };
    expect(serialiseMarkdownTable(data)).toContain('first<br>second');
    expect(parseMarkdownTable(serialiseMarkdownTable(data)).rows).toEqual([['first\nsecond']]);
  });

  it('keeps a trailing empty cell rather than narrowing the row', () => {
    const parsed = parseMarkdownTable('| a | b |\n| --- | --- |\n| 1 | |\n');
    expect(parsed.rows).toEqual([['1', '']]);
  });

  it('keeps two identically named columns distinct, and a column literally named id', () => {
    const parsed = parseMarkdownTable('| id | dup | dup |\n| --- | --- | --- |\n| 7 | x | y |\n');
    expect(parsed.headers).toEqual(['id', 'dup', 'dup']);
    expect(parsed.rows).toEqual([['7', 'x', 'y']]);
    expect(parseMarkdownTable(serialiseMarkdownTable(parsed))).toEqual(parsed);
  });

  it('serialises an empty header list to the empty string', () => {
    expect(serialiseMarkdownTable({ headers: [], rows: [] })).toBe('');
  });

  it('pads a short data row out to the header count', () => {
    expect(parseMarkdownTable('| a | b | c |\n| --- | --- | --- |\n| 1 |\n').rows).toEqual([['1', '', '']]);
  });
});

describe('parseDelimitedText', () => {
  it('parses CSV with quoted cells containing the delimiter', () => {
    expect(parseDelimitedText('a,b\n"x,1",y\n')).toEqual({ headers: ['a', 'b'], rows: [['x,1', 'y']] });
  });

  it('parses a doubled quote as one literal quote', () => {
    expect(parseDelimitedText('a\n"say ""hi"""\n').rows).toEqual([['say "hi"']]);
  });

  it('sniffs TSV when the header line holds more tabs than commas', () => {
    expect(parseDelimitedText('a\tb\n1\t2\n')).toEqual({ headers: ['a', 'b'], rows: [['1', '2']] });
  });

  it('returns an empty table for empty input', () => {
    expect(parseDelimitedText('')).toEqual({ headers: [], rows: [] });
  });

  it('feeds serialiseMarkdownTable directly, escaping a pipe that arrived in a CSV cell', () => {
    const imported = parseDelimitedText('a\n"x | y"\n');
    expect(parseMarkdownTable(serialiseMarkdownTable(imported)).rows).toEqual([['x | y']]);
  });
});
