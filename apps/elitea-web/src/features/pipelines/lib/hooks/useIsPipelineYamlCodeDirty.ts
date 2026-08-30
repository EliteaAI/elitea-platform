/**
 * Ported from `apps/elitea-ui/src/pages/Pipelines/useIsPipelineYamlCodeDirty.js`
 * — `true` when the live YAML editor content differs from the last
 * loaded/saved snapshot, gated to screens where pipeline editing is
 * actually happening (a pipeline detail page, or any chat screen).
 *
 * Reads `../../model/pipelineYamlStore.ts` (this sub-unit's own new store —
 * see that file's own doc comment for why A2n, not A2d's already-landed
 * `pipelineEditorStore.ts`, owns `yamlCode`/`initYamlCode`) instead of the
 * baseline's `useSelector(state => state.pipeline)`.
 *
 * **Route-prefix check, NOT imported from `pages/pipelines/lib/
 * routeMatch.ts`:** that file ports the exact same baseline predicate
 * (`useIsFromPipelineDetail`/`useIsFromChat`, verified: its own doc comment
 * names this file, `useIsPipelineYamlCodeDirty.js:8-9`, as one of its two
 * consumers) but lives in the `pages/` layer — `features/` may not import
 * `pages/` (R-L1, upward-from-features forbidden; the layer order is `app ->
 * processes -> pages -> widgets -> features -> entities -> shared`). Reading
 * that file in full confirms the underlying logic is a plain pathname-regex
 * check against three real route paths (`src/routes/_shell/pipelines/
 * create.tsx`, `$tab.$agentId.tsx`, `$tab.$agentId.$version.tsx`) with no
 * `pages/`-specific dependency of its own — reproduced locally below,
 * verbatim, same disclosed-duplication class as `features/agents/lib/
 * useIsFromApplication.ts`'s own route-prefix duplicate.
 */
import { useMemo } from 'react';

import { load } from 'js-yaml';
import { useRouterState } from '@tanstack/react-router';

import { usePipelineYamlStore } from '../../model/pipelineYamlStore';

const PIPELINE_DETAIL_PATTERNS: readonly RegExp[] = [
  /^\/pipelines\/create$/,
  /^\/pipelines\/[^/]+\/[^/]+$/,
  /^\/pipelines\/[^/]+\/[^/]+\/[^/]+$/,
];

/** Pure, unit-testable directly against a pathname string — same three route paths `pages/pipelines/lib/routeMatch.ts`'s `isPipelineDetailPath` verifies. */
export function isPipelineDetailPath(pathname: string): boolean {
  return PIPELINE_DETAIL_PATTERNS.some((pattern) => pattern.test(pathname));
}

/** Pure, unit-testable directly against a pathname string. */
export function isChatPath(pathname: string): boolean {
  return pathname.startsWith('/chat');
}

/** Pure core of the hook, unit-testable without mounting a router or the store. */
export function computeIsPipelineYamlCodeDirty(
  pathname: string,
  yamlCode: string,
  initYamlCode: string,
): boolean {
  const isEditingPipeline = isPipelineDetailPath(pathname) || isChatPath(pathname);
  if (!isEditingPipeline) return false;

  // Identical text is the cheap, common case.
  if (yamlCode === initYamlCode) return false;

  // COMPARE THE DOCUMENTS, NOT THE TEXT.
  //
  // This used to admit exactly two spellings — the raw baseline, and
  // `dumpYaml(load(baseline))` — and call anything else an edit. The editor
  // produces a THIRD: `EditorPanel`'s `setYamlJsonObject` re-dumps whenever
  // the parsed document changes and overwrites `yamlCode` alone, leaving
  // `initYamlCode` on the raw stored text. Whenever that dump differed from
  // both spellings, a pipeline nobody had touched reported dirty — which
  // armed the unsaved-changes guard, disabled the test-chat pane, and made
  // the "Chat with pipeline" button's own navigation open a "You have unsaved
  // changes" dialog instead of going anywhere. Intermittent, because it
  // depended on whether that re-dump landed before the user acted.
  //
  // Semantics is what the question actually means, and it keeps the case the
  // textual check was protecting: a legacy-node migration REWRITES the
  // document, so it still reports dirty and stays saveable. Only formatting
  // stops counting — which is correct, since the editor re-dumps on save
  // regardless, so no formatting a user typed was ever going to survive.
  let live: string;
  try {
    live = stableStringify(load(yamlCode || ''));
  } catch {
    // Text the parser refuses is an edit in progress, not a match.
    return true;
  }

  const baseline = baselineFingerprint(initYamlCode);
  // An unparseable BASELINE cannot be compared; the text already differs.
  if (baseline === UNPARSEABLE) return true;

  return live !== baseline;
}

/**
 * Distinguishes "the baseline does not parse" from "the baseline parses to
 * nothing". `JSON.stringify(undefined)` is itself `undefined`, so an EMPTY
 * baseline and a broken one would otherwise be the same value — and they
 * mean opposite things here.
 */
const UNPARSEABLE = Symbol('unparseable-baseline');

/**
 * The baseline's `stableStringify(load(...))`, cached on the text it came
 * from.
 *
 * `yamlCode` changes on every keystroke in the YAML tab, so this function
 * runs per character — but `initYamlCode` only moves on load and save, and
 * re-parsing plus re-sorting an unchanged document (the compiler admits up
 * to 128 nodes) on every one of those keystrokes is pure waste. One entry is
 * enough: there is a single baseline on screen at a time.
 *
 * `undefined` means the baseline does not parse, which the caller treats as
 * "cannot compare".
 */
let baselineText: string | undefined;
let baselineValue: string | typeof UNPARSEABLE;

function baselineFingerprint(initYamlCode: string): string | typeof UNPARSEABLE {
  if (baselineText === initYamlCode) return baselineValue;
  baselineText = initYamlCode;
  try {
    baselineValue = stableStringify(load(initYamlCode || ''));
  } catch {
    baselineValue = UNPARSEABLE;
  }
  return baselineValue;
}

/**
 * `JSON.stringify` with object keys sorted at every depth, so two documents
 * that differ only in key ORDER compare equal. Array order is preserved —
 * `nodes:` is a sequence and its order is meaningful.
 *
 * Needed because the editor rebuilds document objects by spreading rather
 * than by editing in place, so a round trip can reorder keys without changing
 * anything the runtime reads.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([key, entry]) => [key, sortDeep(entry)]));
}

export function useIsPipelineYamlCodeDirty(): boolean {
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  const yamlCode = usePipelineYamlStore((state) => state.yamlCode);
  const initYamlCode = usePipelineYamlStore((state) => state.initYamlCode);

  return useMemo(
    () => computeIsPipelineYamlCodeDirty(pathname, yamlCode, initYamlCode),
    [pathname, yamlCode, initYamlCode],
  );
}
