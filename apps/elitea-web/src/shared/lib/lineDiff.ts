/**
 * A line diff, hand-rolled.
 *
 * WHY NOT THE `diff` PACKAGE. The legacy bundle imports it for one call site —
 * `Diff.diffLines(original, fixed)` rendering a quick-fix preview. Adding a
 * dependency to this app for one preview costs bundle budget on every page and
 * gives knip a package to police, for an algorithm that is ~60 lines. The plan
 * for this port named the trade and chose this side.
 *
 * WHAT IT COMPUTES. A longest-common-subsequence over LINES, walked back into
 * a list of unchanged / added / removed runs. Line granularity, not word or
 * character: the thing being diffed is a mermaid diagram whose lines are edges
 * and nodes, and a character diff of `A --> B` against `A --> C` highlights one
 * letter in a line the reader has to re-read anyway.
 *
 * THE SIZE GUARD IS NOT AN OPTIMISATION. LCS is O(n×m) in both time and
 * memory, and this runs in the browser on content the SERVER produced — a
 * generated page can be thousands of lines. Beyond the bound it degrades to a
 * whole-block replace, which is honest: "these lines became those lines" is
 * what a reader gets, rather than a frozen tab.
 */

// Not exported: reached through DiffPart, which is. It becomes public when a
// renderer switches on it (DWIKI-007).
type DiffKind = 'unchanged' | 'added' | 'removed';

export interface DiffPart {
  readonly kind: DiffKind;
  readonly lines: readonly string[];
}

/**
 * Above this many lines on either side, the diff degrades to a replace.
 *
 * 2000×2000 is four million cells — around 32MB for the table below and
 * noticeably slow. A quick-fix preview of a mermaid block is tens of lines;
 * anything approaching this bound is not the case this exists for.
 */
const MAX_LINES = 2000;

function splitLines(text: string): string[] {
  // An EMPTY document is zero lines. String.split returns [''] for '', which
  // would render one blank line and diff as a changed line against real
  // content — so a fix that adds the first line of a page would show a
  // spurious removal above it.
  if (text === '') return [];

  // A trailing newline yields a final empty element, which would render as a
  // phantom changed line. Dropped, and only the last one — a blank line in the
  // middle of a diagram is content, and '\n' is genuinely one empty line.
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Group consecutive lines of the same kind into runs. */
function coalesce(entries: readonly { kind: DiffKind; line: string }[]): DiffPart[] {
  const parts: DiffPart[] = [];
  for (const entry of entries) {
    const last = parts[parts.length - 1];
    if (last && last.kind === entry.kind) {
      (last.lines as string[]).push(entry.line);
    } else {
      parts.push({ kind: entry.kind, lines: [entry.line] });
    }
  }
  return parts;
}

/**
 * Diff two texts by line.
 *
 * Returns runs in reading order: every line of `before` appears exactly once as
 * `unchanged` or `removed`, and every line of `after` exactly once as
 * `unchanged` or `added`. A renderer can therefore show the whole document
 * without consulting the inputs again.
 */
/** The degraded answer when a document is too large to diff. */
function wholeBlockReplace(a: readonly string[], b: readonly string[]): DiffPart[] {
  const parts: DiffPart[] = [];
  if (a.length > 0) parts.push({ kind: 'removed', lines: [...a] });
  if (b.length > 0) parts.push({ kind: 'added', lines: [...b] });
  return parts;
}

/** lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:]. */
function buildTable(a: readonly string[], b: readonly string[]) {
  // One flat typed array rather than an array of arrays:
  // noUncheckedIndexedAccess makes every nested read an `undefined` the
  // compiler has to be argued out of, and the index arithmetic is clearer than
  // the assertions would be.
  const width = b.length + 1;
  const lcs = new Int32Array((a.length + 1) * width);
  const at = (i: number, j: number): number => lcs[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  return at;
}

/** Walk the table forwards into a per-line list. */
function walk(
  a: readonly string[],
  b: readonly string[],
  at: (i: number, j: number) => number,
): { kind: DiffKind; line: string }[] {
  const entries: { kind: DiffKind; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      entries.push({ kind: 'unchanged', line: a[i] ?? '' });
      i += 1;
      j += 1;
      continue;
    }
    // REMOVED FIRST on a tie. A changed line then reads as its old text
    // followed by its new text, which is the order every diff tool shows and
    // the order a reader expects.
    if (at(i + 1, j) >= at(i, j + 1)) {
      entries.push({ kind: 'removed', line: a[i] ?? '' });
      i += 1;
    } else {
      entries.push({ kind: 'added', line: b[j] ?? '' });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) entries.push({ kind: 'removed', line: a[i] ?? '' });
  for (; j < b.length; j += 1) entries.push({ kind: 'added', line: b[j] ?? '' });
  return entries;
}

/**
 * Diff two texts by line.
 *
 * Returns runs in reading order: every line of `before` appears exactly once as
 * `unchanged` or `removed`, and every line of `after` exactly once as
 * `unchanged` or `added`. A renderer can therefore show the whole document
 * without consulting the inputs again.
 */
export function lineDiff(before: string, after: string): DiffPart[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length > MAX_LINES || b.length > MAX_LINES) return wholeBlockReplace(a, b);
  return coalesce(walk(a, b, buildTable(a, b)));
}
