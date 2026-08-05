import { useMemo } from 'react';

import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';

import { getToolkitIcon } from '../helpers/toolkits.helpers';
import type { ToolkitIconInfo, ToolkitTypeInfoLike } from '../helpers/toolkits.helpers';

import { useGetCurrentToolkitSchemas } from './useGetCurrentToolkitSchemas.hooks';

/**
 * Ported from `apps/elitea-ui/src/hooks/toolkit/useIconMetaTooltipType.js`
 * (25 lines), for `NameDescriptionInput.jsx:43` (`useIconMetaTooltipType(type,
 * isMCP)`), A4d's ONE consumer of this hook.
 *
 * DISCLOSED REDESIGN: the baseline calls `getToolIconByType(type, theme,
 * {toolSchema, isMCP})` — a per-brand SVG resolver (~30 toolkit-type icons)
 * with no port anywhere in this app (`../helpers/toolkits.helpers.ts`'s own
 * module doc comment, point 4, already documents this exact gap and its
 * established resolution: resolve a semantic `ToolkitIconKind` tag instead
 * of a brand icon component). This hook is a thin wrapper over that same
 * file's already-landed, already-tested `getToolkitIcon` — it does NOT
 * duplicate the icon-kind-resolution logic a second time, only adapts a bare
 * `type`/`isMCP` pair (this hook's own params) into the `ToolkitIconLike`
 * shape `getToolkitIcon` expects. No `theme` parameter: it existed in the
 * baseline only to colour the now-absent per-brand SVG.
 */
export interface UseToolkitIconKindResult {
  readonly iconKind: ToolkitIconInfo['iconKind'] | undefined;
  readonly label: string | undefined;
}

/**
 * `ToolkitTypeSchemaMap`'s value type (`Readonly<Record<string, unknown>>`,
 * `entities/toolkit/model/types.ts`) is intentionally opaque — the real
 * server-pushed schema shape isn't typed field-by-field there. `getToolkitIcon`
 * only ever reads one specific, optional, nested field off it
 * (`typeInfo?.metadata?.label`) — this cast documents that narrowing
 * (structurally compatible, not behaviourally different) rather than
 * loosening `getToolkitIcon`'s own parameter type for one caller.
 */
function asToolkitTypeInfoMap(schemas: ToolkitTypeSchemaMap | undefined): Readonly<Record<string, ToolkitTypeInfoLike | undefined>> {
  return schemas ?? {};
}

export function useToolkitIconKind(type: string | undefined, isMCP: boolean): UseToolkitIconKindResult {
  const { toolkitSchemas } = useGetCurrentToolkitSchemas({ isMCP });

  return useMemo(() => {
    if (type === undefined) return { iconKind: undefined, label: undefined };
    const info = getToolkitIcon({ type }, asToolkitTypeInfoMap(toolkitSchemas), isMCP);
    return { iconKind: info.iconKind, label: info.label };
  }, [type, toolkitSchemas, isMCP]);
}
