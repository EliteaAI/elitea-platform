/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/helpers/
 * toolkits.helpers.js` (349 lines, Wave-2 unit A4b) — blocklist checks, a
 * toolkit's display-name resolution, and its icon-category/tag/label
 * list-enhancement pass.
 *
 * Chat-message pretty-printing (`prettifyToolkitMessage`/
 * `prettifyToolkitConversation` and the parameter-string parsing they lean
 * on) is a SEPARATE new-app file, `./toolkitMessage.helpers.ts` — split
 * purely to stay under the §3.5 400-line-per-file budget (the single
 * baseline file is 349 lines; the two concerns combined ported to well
 * over 400 once fully typed — same "split across files" precedent
 * `entities/toolkit/model/toolForm.ts`'s own doc comment documents for the
 * 487-line `consts.js`). Genuinely a different topic either way (message
 * formatting vs. toolkit identity/icon), so the split is a clean seam, not
 * an arbitrary line cut.
 *
 * THREE baseline dependencies replaced (cited individually at their call
 * sites below):
 *
 *  1. `ParticipantEntityTypes` (`features/chat/participants/lib/constants`)
 *     — sideways-forbidden. Only `.Pipeline`/`.Agent` (`'pipeline'`/
 *     `'agent'`) are used, as bare comparison targets, not as an imported
 *     catalogue object — kept as literals (matching
 *     `features/pipelines/ui/select/EntityOptionIcon.tsx`'s
 *     `resolvePipelineToolEntityType`, which made the identical call for
 *     the identical two literals: "baseline literal was `'application'`
 *     for the non-pipeline case... `'agent'` here is behaviourally
 *     identical, not a deviation").
 *  2. `CredentialNameHelpers.extraCredentialName` (`features/credentials/
 *     lib/helpers`) — sideways-forbidden. `entities/credential`'s
 *     `providerDisplayName` is the exact same baseline function
 *     (`credentialName.helpers.js:3-10`), already ported and publicly
 *     exported (`entities/credential/index.ts`) — `entities/` is a legal
 *     downward import, reused instead of a second copy.
 *  3. `BLOCKED_TOOLKITS` (`common/constants.js:19`,
 *     `getEnvVar('blocked_toolkits', [])`) — `shared/config`'s schema has
 *     no `blocked_toolkits` key (real, disclosed gap — the SAME one
 *     `features/agents/lib/toolkitBlocklist.ts` already documents for its
 *     own copy of this exact function). `isToolkitTypeBlocked` below takes
 *     the blocklist as a parameter instead of reading a module-level
 *     constant; a page/widget-layer caller wires a real source once
 *     `shared/config` grows the key.
 *  4. `getToolIconByType` (`common/toolkitUtils.jsx`, ~30 brand SVGs) — this
 *     app has not ported a full per-toolkit-type brand-icon resolver
 *     anywhere (grepped `shared/ui/icons/`: partial brand coverage only —
 *     e.g. no `github-icon`/`confluence-icon`/`gitlab-icon`/`yagmail-icon`).
 *     **Established, already-landed precedent for this exact gap**:
 *     `features/agents/ui/generate-agent-modal/SuggestionItem.tsx` and
 *     `features/pipelines/ui/select/EntityOptionIcon.tsx` both drop the
 *     per-brand lookup and resolve a semantic entity-type tag instead
 *     ("drop the decorative fanciness, keep the function"). `getToolkitIcon`
 *     below follows the same call: it resolves a semantic `ToolkitIconKind`
 *     tag (not a component reference) plus the display label; a `ui/`-layer
 *     caller (owned by a different A4 sub-unit) maps the tag to whatever
 *     icon component is available. This also drops the baseline's `theme`
 *     parameter entirely — it existed only to colour the now-absent
 *     per-brand SVG.
 */
import { providerDisplayName } from '@/entities/credential';
import { ToolTypes } from '@/entities/toolkit';

import { McpCategory } from '../constants/mcp.constants';

/** Separator/case-insensitive key, matching the SDK/admin guardrail normalization so 'GitHub', 'github' and 'git_hub' all collapse to the same comparison key. */
function canonToolkitKey(value: string | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * True when a toolkit `type` is on the org guardrails blocklist. Matching
 * is case/separator-insensitive. `blockedToolkitTypes` replaces the
 * baseline's module-level `BLOCKED_TOOLKITS` read (real gap, see module doc
 * comment point 3).
 */
export function isToolkitTypeBlocked(type: string | undefined, blockedToolkitTypes: readonly string[] | undefined): boolean {
  const key = canonToolkitKey(type);
  return Boolean(key) && (blockedToolkitTypes ?? []).some((blocked) => canonToolkitKey(blocked) === key);
}

/**
 * Display label for a toolkit TYPE (e.g. 'github' -> 'Github'). Blocking is
 * done by type, so the blocked-toolkit warning must name the type — never
 * the user's instance/configuration name (every toolkit of this type is
 * blocked regardless).
 */
export function getToolkitTypeLabel(type: string | undefined): string {
  const t = typeof type === 'string' ? type.trim() : '';
  if (!t) return 'Toolkit';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Strips everything but alphanumerics, underscore and hyphen, then folds `.` into `_`. */
function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^a-zA-Z0-9_.-]/g, '').replace(/\./g, '_') : '';
}

interface GenToolkitNameSchema {
  readonly properties?: Readonly<Record<string, { readonly toolkit_name?: boolean } | undefined>>;
}

/** `name` -> `settings.elitea_title` -> `settings.configuration_title` -> `''`, cleaned. `||` throughout — a blank string is treated as "absent" and falls through, matching the baseline exactly. */
function genToolkitNameFallback(toolkit: { readonly name?: string; readonly settings?: Readonly<Record<string, unknown>> }): string {
  return cleanString(toolkit.name || toolkit.settings?.['elitea_title'] || toolkit.settings?.['configuration_title'] || '');
}

/**
 * `genToolkitName` — resolves a toolkit's display name: the schema
 * property flagged `toolkit_name` (if any) on `toolkit.settings`, else
 * `genToolkitNameFallback`.
 */
export function genToolkitName(
  toolkit: { readonly type?: string; readonly name?: string; readonly settings?: Readonly<Record<string, unknown>> },
  schemaOfTools: Readonly<Record<string, GenToolkitNameSchema | undefined>>,
): string {
  const schema = (toolkit.type !== undefined ? schemaOfTools[toolkit.type] : undefined) ?? {};
  const [key] = Object.entries(schema.properties ?? {}).find(([, value]) => value?.toolkit_name) ?? [];
  const fallback = genToolkitNameFallback(toolkit);

  if (key === undefined) return fallback;

  return cleanString(toolkit.settings?.[key]) || fallback;
}

/**
 * Semantic icon category a `ui/`-layer caller maps to an actual icon
 * component — see module doc comment point 4 for why this returns a tag
 * instead of a resolved component/brand icon. Not exported: no current
 * caller needs the bare union apart from `ToolkitIconInfo`/
 * `EnhancedToolkitIconMeta` below (whose OWN `iconKind` field is how
 * callers actually observe this).
 */
type ToolkitIconKind = 'agent' | 'pipeline' | 'toolkit';

export interface ToolkitIconLike {
  readonly type: string;
  readonly agent_type?: string;
  readonly meta?: { readonly application?: boolean };
}

export interface ToolkitTypeInfoLike {
  readonly metadata?: { readonly label?: string };
}

export interface ToolkitIconInfo {
  readonly iconKind: ToolkitIconKind;
  readonly label: string;
}

/** The non-MCP label-resolution branch of `getToolkitIcon`, split out to stay under the §3.5 complexity budget. */
function resolveNonMcpToolkitLabel(toolkit: ToolkitIconLike, typeInfo: ToolkitTypeInfoLike | undefined): ToolkitIconInfo {
  if (toolkit.type !== ToolTypes.application.value) {
    const capitalizedType = toolkit.type.charAt(0).toUpperCase() + toolkit.type.slice(1);
    return { iconKind: 'toolkit', label: typeInfo?.metadata?.label ?? providerDisplayName(capitalizedType) };
  }

  const iconKind: ToolkitIconKind = toolkit.agent_type !== 'pipeline' ? 'agent' : 'pipeline';
  const capitalizedType = iconKind.charAt(0).toUpperCase() + iconKind.slice(1);
  return { iconKind, label: typeInfo?.metadata?.label ?? providerDisplayName(capitalizedType) };
}

/**
 * `getToolkitIcon` — resolves a toolkit's icon category and display label.
 * MCP branch: `Remote` for the synthesized `'mcp'` type, `Local` for a
 * user's own discovered MCP server. Non-MCP branch: an `application`-typed
 * toolkit resolves to `agent`/`pipeline` per `agent_type`; anything else
 * stays `toolkit`. Label falls back through the schema's own
 * `metadata.label`, then `entities/credential`'s `providerDisplayName`
 * (baseline: `CredentialNameHelpers.extraCredentialName`) applied to the
 * capitalized type/kind name.
 */
export function getToolkitIcon(
  toolkit: ToolkitIconLike,
  toolkitSchemas: Readonly<Record<string, ToolkitTypeInfoLike | undefined>>,
  isMCP: boolean,
): ToolkitIconInfo {
  const typeInfo = toolkitSchemas[toolkit.type];

  if (isMCP) {
    const label = toolkit.type === 'mcp' ? McpCategory.Remote : McpCategory.Local;
    return { iconKind: 'toolkit', label };
  }

  return resolveNonMcpToolkitLabel(toolkit, typeInfo);
}

export interface EnhanceableToolkit extends ToolkitIconLike {
  readonly [key: string]: unknown;
}

/** Not exported: no current caller needs these two apart from `EnhancedToolkit<T>` below (which is exported and consumed by `useLoadToolkits.ts`). */
interface EnhancedToolkitTag {
  readonly id: string;
  readonly name: string;
  readonly data: { readonly type: string };
}

interface EnhancedToolkitIconMeta {
  readonly iconKind: ToolkitIconKind;
  readonly alt: string;
  readonly type: 'icon-kind';
}

export type EnhancedToolkit<T extends EnhanceableToolkit> = T & {
  readonly tags: readonly [EnhancedToolkitTag];
  readonly icon_meta: EnhancedToolkitIconMeta;
  readonly label: string;
};

/**
 * `enhanceToolkitData` — attaches `tags`/`icon_meta`/`label` to every
 * toolkit in `toolkits`, memoising `getToolkitIcon`'s result per distinct
 * `type` within one call (the baseline's own `Map`-based `typeCache`).
 * `type: 'application'` is normalised to `'agent'` in the tag's `data.type`
 * (baseline comment preserved: "Normalize 'application' to 'app'" — the
 * baseline's OWN literal value is `'agent'`, not `'app'`; the comment text
 * itself is stale in the baseline, the VALUE is ported verbatim). Returns
 * `undefined` unchanged, matching the baseline's `if (!toolkits) return
 * toolkits`.
 */
export function enhanceToolkitData<T extends EnhanceableToolkit>(
  toolkits: readonly T[] | undefined,
  toolkitSchemas: Readonly<Record<string, ToolkitTypeInfoLike | undefined>>,
  isMCP: boolean,
): readonly EnhancedToolkit<T>[] | undefined {
  if (!toolkits) return undefined;

  const typeCache = new Map<string, ToolkitIconInfo>();

  return toolkits.map((toolkit): EnhancedToolkit<T> => {
    let cached = typeCache.get(toolkit.type);
    if (!cached) {
      cached = getToolkitIcon(toolkit, toolkitSchemas, isMCP);
      typeCache.set(toolkit.type, cached);
    }
    const { iconKind, label } = cached;
    const normalisedType = toolkit.type === 'application' ? 'agent' : toolkit.type;

    return {
      ...toolkit,
      tags: [{ id: toolkit.type, name: label, data: { type: normalisedType } }],
      icon_meta: { iconKind, alt: `${label} icon`, type: 'icon-kind' },
      label,
    };
  });
}
