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

import { dumpYaml } from '../dumpYaml.helpers';
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

  let reDumpedYamlCode = '';
  try {
    const parsed = load(initYamlCode);
    reDumpedYamlCode = parsed !== undefined ? dumpYaml(parsed) : '';
  } catch {
    // YAML parsing failed, reDumpedYamlCode stays ''.
  }

  return yamlCode !== reDumpedYamlCode && yamlCode !== initYamlCode;
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
