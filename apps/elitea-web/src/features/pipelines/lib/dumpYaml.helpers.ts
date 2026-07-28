/**
 * Local duplicate of `apps/elitea-ui/src/[fsd]/shared/lib/helpers/
 * dumpYaml.helpers.js` (`dumpYaml`) — the pipeline-flow-editor's custom
 * YAML serializer (node `id`/`type` reordered first, top-level keys ordered
 * `state -> entry_point -> interrupt_after -> interrupt_before -> nodes`,
 * `lineWidth: -1` to prevent wrapping).
 *
 * This lives under `shared/lib/` in the baseline (unit S3's ownership
 * fence), but is NOT present anywhere in this worktree as of this sub-unit's
 * (A2n) writing — verified: `grep -rl "reorderNodeKeys\|lineWidth: -1" src`
 * returns zero hits, and S3 (marked complete) evidently did not carry this
 * specific file across. Two of A2n's own owned files need it directly
 * (`EditorPanel.tsx`'s `setYamlJsonObject`, mirroring the baseline's
 * `EditorPanel.jsx:90`; `useIsPipelineYamlCodeDirty.ts`'s re-dump comparison,
 * mirroring `useIsPipelineYamlCodeDirty.js:24`), so — per this mission's own
 * established precedent for a genuinely-needed, not-owned, not-yet-landed
 * dependency (see the preamble's four-hooks list and this same worktree's
 * `features/agents/lib/hooks/applicationChat.helpers.ts`'s
 * `getWelcomeMessage`/`getInitialChatHistory` duplication for the identical
 * situation) — it is duplicated locally here rather than invented,
 * skipped, or imported from a path that does not exist. A future `shared/
 * lib` pass can promote this verbatim and both call sites can switch to the
 * promoted import with zero behavioural change.
 *
 * **Disclosed deviation:** the baseline's `dump(processedData, { lineWidth:
 * -1, sortKeys, noCompatMode: true })` passes a `noCompatMode` flag that
 * does not exist on this app's pinned `js-yaml@5.2.2`'s `DumpOptions` type
 * (verified: `node_modules/js-yaml/dist/js-yaml.d.ts`'s `PresenterOptions`/
 * `DumpOptions` interfaces list no such field — that flag was removed
 * between the baseline's js-yaml v3 and this app's v5). Omitted here rather
 * than passed as an unchecked excess property; v5's dumper already emits
 * the modern (non-"compat") style unconditionally, so this is a type-only
 * no-op, not a behaviour change.
 */
import { dump } from 'js-yaml';

/** `state -> entry_point -> interrupt_after -> interrupt_before -> nodes` — baseline `dumpYaml.helpers.js:4`. */
const TOP_LEVEL_KEY_ORDER: readonly string[] = ['state', 'entry_point', 'interrupt_after', 'interrupt_before', 'nodes'];

/** Node-object field priority — `id`/`type` always sort first among a node's own keys. */
const NODE_PRIORITY_FIELDS: readonly string[] = ['id', 'type'];

function compareByOrder(a: string, b: string, orderArray: readonly string[]): number {
  const indexA = orderArray.indexOf(a);
  const indexB = orderArray.indexOf(b);
  if (indexA !== -1 && indexB !== -1) return indexA - indexB;
  if (indexA !== -1) return -1;
  if (indexB !== -1) return 1;
  return a.localeCompare(b);
}

function isSerializable(value: unknown): boolean {
  const type = typeof value;
  return type !== 'function' && type !== 'symbol';
}

function reorderNodeKeys(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => reorderNodeKeys(item));
  }

  const record = obj as Record<string, unknown>;

  if ('id' in record && 'type' in record) {
    const reordered: Record<string, unknown> = {};
    if (isSerializable(record['id'])) reordered['id'] = record['id'];
    if (isSerializable(record['type'])) reordered['type'] = record['type'];
    Object.keys(record).forEach((key) => {
      if (key === 'id' || key === 'type') return;
      const value = record[key];
      if (isSerializable(value)) reordered[key] = reorderNodeKeys(value);
    });
    return reordered;
  }

  const processed: Record<string, unknown> = {};
  Object.keys(record).forEach((key) => {
    const value = record[key];
    if (isSerializable(value)) processed[key] = reorderNodeKeys(value);
  });
  return processed;
}

function sortYamlKeys(a: string, b: string): number {
  const aIsPriority = NODE_PRIORITY_FIELDS.includes(a);
  const bIsPriority = NODE_PRIORITY_FIELDS.includes(b);

  if (aIsPriority && bIsPriority) return NODE_PRIORITY_FIELDS.indexOf(a) - NODE_PRIORITY_FIELDS.indexOf(b);
  if (aIsPriority) return -1;
  if (bIsPriority) return 1;

  return compareByOrder(a, b, TOP_LEVEL_KEY_ORDER);
}

/** Dumps `data` to YAML with the flow editor's custom key ordering. Never throws — mirrors the baseline's own try/catch, returning an `Error dumping YAML: ...` string instead. */
export function dumpYaml(data: unknown): string {
  try {
    const processedData = reorderNodeKeys(data);
    return dump(processedData, {
      lineWidth: -1,
      sortKeys: sortYamlKeys,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return `Error dumping YAML: ${message}`;
  }
}
