/**
 * lib/markdownTable.ts — the pure half of the canvas markdown-table editor
 * (Canvas slice 3). Ported from `apps/elitea-ui/src/components/
 * MarkdownTableEditor.jsx`'s module-scope `splitRow` / `parseMarkdownTable` /
 * `convertToMarkdown` helpers plus `apps/elitea-ui/src/components/
 * ImportTableButton.jsx`'s `convertToMarkdown` CSV path.
 *
 * Everything here is `(string) -> data` or `(data) -> string`; no React, no
 * MUI, no DataGrid. The component half lives in
 * `../ui/canvas/table/MarkdownTableEditor.tsx` and the grid-cell renderers in
 * its sibling `markdownTableCells.tsx` — the 859-line baseline component is
 * split three ways to stay under the §3.5 400-line budget.
 *
 * **DEVIATIONS (disclosed):**
 *
 *  1. `parseMarkdownTable` returns `{ headers, rows }` where `rows` is a
 *     `string[][]` of CELLS, not the baseline's array of objects keyed by
 *     header text. The baseline used the header text as the DataGrid `field`
 *     AND as the row-object key, which silently corrupts two real tables:
 *     a table with two identically-named columns loses one of them, and a
 *     table with a column literally called `id` collides with the row id the
 *     baseline injects (`{ id: index + 1 }`) — the id wins and the column
 *     renders the row number. Cell arrays are positional, so neither can
 *     happen; the component assigns its own opaque `field` ids
 *     (`col_0`, `col_1`, …) and keeps the header text in `headerName`, which
 *     is the only thing `serialiseMarkdownTable` ever writes back out.
 *  2. CSV import is parsed here (`parseDelimitedText`) rather than by
 *     `papaparse`, which the baseline's `ImportTableButton` pulled in. The
 *     new app has no papaparse dependency and this is ~40 lines of RFC-4180
 *     quoting; adding a dependency for it is not worth it. TSV is accepted
 *     too (the baseline accepted `.csv` only, but the delimiter sniff is
 *     free once the quoting is written).
 */

/** A table as the editor exchanges it: header texts plus positional cell rows. */
export interface MarkdownTableData {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/**
 * Splits one markdown table row on unescaped `|`, honouring `\|` (a literal
 * pipe inside a cell) and `\\` (a literal backslash). The leading empty cell
 * produced by a row's opening `|` is dropped by the caller, not here.
 */
function splitRow(row: string): string[] {
  const cells: string[] = [];
  let current = '';
  let escaped = false;

  for (const char of row) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  // A row that ends with `|` has already pushed its last cell above; only a
  // row with an unterminated final cell reaches this push.
  if (current !== '') cells.push(current.trim());
  return cells;
}

/** `<br>` is how a newline survives a markdown table cell; undo that on read. */
function decodeCell(cell: string): string {
  return cell.trim().replaceAll('<br>', '\n');
}

/** Escape order matters: backslashes first, or the `\|` we add is then re-escaped. */
function encodeCell(cell: string): string {
  return cell.replaceAll('\\', '\\\\').replaceAll('\n', '<br>').replaceAll('|', '\\|');
}

/**
 * Parses a GitHub-flavoured markdown table into headers + positional cells.
 * Line 0 is the header row, line 1 the `---` separator (discarded), the rest
 * are data. A cell shorter than the header row is padded with `''`.
 */
export function parseMarkdownTable(markdown: string): MarkdownTableData {
  const lines = markdown.trim().split('\n');
  if (lines.length === 0 || lines[0] === undefined || lines[0] === '') {
    return { headers: [], rows: [] };
  }

  const headers = splitRow(lines[0]).slice(1).map(decodeCell);
  const rows = lines.slice(2).map((line) => {
    const cells = splitRow(line).slice(1).map(decodeCell);
    return headers.map((_header, index) => cells[index] ?? '');
  });

  return { headers, rows };
}

/**
 * The inverse of `parseMarkdownTable`. An empty header list serialises to the
 * empty string (matching the baseline's `columns.length ? … : ''`), so
 * deleting every column clears the canvas rather than emitting a bare `| |`.
 */
export function serialiseMarkdownTable({ headers, rows }: MarkdownTableData): string {
  if (headers.length === 0) return '';

  const headerLine = `| ${headers.map(encodeCell).join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows
    .map((row) => `| ${headers.map((_h, index) => encodeCell(row[index] ?? '')).join(' | ')} |`)
    .join('\n');

  return `${headerLine}\n${separator}\n${body}\n\n`;
}

/** Splits one delimited line, honouring RFC-4180 `"…"` quoting and `""` escapes. */
function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

/** Picks `\t` over `,` when the header line holds more tabs than commas. */
function sniffDelimiter(headerLine: string): string {
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

/**
 * Parses pasted/uploaded CSV or TSV into the same shape `parseMarkdownTable`
 * returns, so `resetTable` takes either without caring where it came from.
 * The first line is the header row (the baseline's `data[0]`).
 */
export function parseDelimitedText(text: string): MarkdownTableData {
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n').filter((line) => line !== '');
  const first = lines[0];
  if (first === undefined) return { headers: [], rows: [] };

  const delimiter = sniffDelimiter(first);
  const headers = splitDelimitedLine(first, delimiter).map((cell) => cell.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = splitDelimitedLine(line, delimiter);
    return headers.map((_h, index) => cells[index]?.trim() ?? '');
  });

  return { headers, rows };
}
