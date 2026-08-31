/**
 * Port of `apps/elitea-ui/src/[fsd]/entities/edit-entity-with-ai/lib/helpers/
 * textDiff.helpers.js` — a word-level LCS diff, used to show what an AI edit
 * would actually change before the user accepts it.
 *
 * Tokenises on runs of whitespace/non-whitespace so whitespace survives the
 * round trip (`segments.map(s => s.text).join('')` over the `equal`+`removed`
 * segments reconstructs the original exactly, and over `equal`+`added` the
 * modified text) — the property the renderer relies on to show one side or
 * the other from a single pass.
 */

type TextDiffSegmentType = 'equal' | 'added' | 'removed';

export interface TextDiffSegment {
  readonly type: TextDiffSegmentType;
  readonly text: string;
}

function tokenize(value: string): string[] {
  return value.match(/\S+|\s+/g) ?? [];
}

function lcsMatrix(originalTokens: readonly string[], modifiedTokens: readonly string[]): Uint16Array[] {
  const matrix = Array.from({ length: originalTokens.length + 1 }, () => new Uint16Array(modifiedTokens.length + 1));
  for (let origIdx = 1; origIdx <= originalTokens.length; origIdx++) {
    const row = matrix[origIdx];
    const previous = matrix[origIdx - 1];
    if (row === undefined || previous === undefined) continue;
    for (let modIdx = 1; modIdx <= modifiedTokens.length; modIdx++) {
      row[modIdx] =
        originalTokens[origIdx - 1] === modifiedTokens[modIdx - 1]
          ? (previous[modIdx - 1] ?? 0) + 1
          : Math.max(previous[modIdx] ?? 0, row[modIdx - 1] ?? 0);
    }
  }
  return matrix;
}

/**
 * Which side the next backtrack step comes from. Split out of `backtrack`
 * purely to keep that function inside the §3.5 cyclomatic-complexity budget:
 * the three-way choice and its index-guard `??`s are all here.
 */
function nextStep(
  matrix: readonly Uint16Array[],
  origIdx: number,
  modIdx: number,
  isEqual: boolean,
): 'equal' | 'added' | 'removed' {
  if (isEqual) return 'equal';
  if (modIdx === 0) return 'removed';
  if (origIdx === 0) return 'added';
  return (matrix[origIdx]?.[modIdx - 1] ?? 0) >= (matrix[origIdx - 1]?.[modIdx] ?? 0) ? 'added' : 'removed';
}

function backtrack(
  matrix: readonly Uint16Array[],
  originalTokens: readonly string[],
  modifiedTokens: readonly string[],
): TextDiffSegment[] {
  const segments: { type: TextDiffSegmentType; text: string }[] = [];

  // Adjacent same-type tokens are merged as they are prepended, so the
  // renderer gets one span per RUN rather than one per word.
  const prepend = (type: TextDiffSegmentType, text: string): void => {
    const head = segments[0];
    if (head !== undefined && head.type === type) head.text = text + head.text;
    else segments.unshift({ type, text });
  };

  let origIdx = originalTokens.length;
  let modIdx = modifiedTokens.length;

  while (origIdx > 0 || modIdx > 0) {
    const isEqual =
      origIdx > 0 && modIdx > 0 && originalTokens[origIdx - 1] === modifiedTokens[modIdx - 1];
    const step = nextStep(matrix, origIdx, modIdx, isEqual);
    if (step === 'added') {
      prepend('added', modifiedTokens[modIdx - 1] ?? '');
      modIdx--;
      continue;
    }
    prepend(step, originalTokens[origIdx - 1] ?? '');
    origIdx--;
    if (step === 'equal') modIdx--;
  }

  return segments;
}

export function computeWordDiff(original: string, modified: string): TextDiffSegment[] {
  if (original === modified) return original === '' ? [] : [{ type: 'equal', text: original }];
  if (original === '') return modified === '' ? [] : [{ type: 'added', text: modified }];
  if (modified === '') return [{ type: 'removed', text: original }];

  const originalTokens = tokenize(original);
  const modifiedTokens = tokenize(modified);
  return backtrack(lcsMatrix(originalTokens, modifiedTokens), originalTokens, modifiedTokens);
}
