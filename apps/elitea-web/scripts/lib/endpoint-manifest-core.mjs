/**
 * endpoint-manifest-core.mjs — pure decision logic for
 * scripts/check-endpoint-manifest.mjs, the R-A5 enforcement mechanism
 * (unit S4; spec §3.4 R-A5, §5.3, §9.3). No fs access here; the CLI wrapper
 * owns reading `endpoints.manifest.json`, scanning
 * `src/shared/api/generated/**` and `parity/manifest/*.json`, and printing.
 *
 * R-A5: "Every network call must go through a generated or hand-registered
 * endpoint in `shared/api/endpoints/`, and appear in `endpoints.manifest.json`."
 * This module enforces the two hard-fail conditions the S4 task specifies:
 *
 *   (a) a manifest entry claims `source: 'generated'` but has no
 *       `operationId` — an ungenerated entry cannot claim to be generated.
 *   (b) a manifest entry claims `source: 'generated'` with an `operationId`
 *       that is not actually in the generated set — the entry describes an
 *       endpoint orval never produced, i.e. contract drift.
 *
 * `source: 'handwritten'` entries are validated far more loosely (spec
 * §5.3: their zod schema is "authored by hand from a Channel-B fixture",
 * and Wave-2 units land them incrementally) — only structural sanity
 * (id/method/path present) applies to those.
 */

const REQUIRED_STRING_FIELDS = ['id', 'method', 'path'];
const VALID_SOURCES = new Set(['generated', 'handwritten']);
const VALID_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function checkRequiredFields(entry, label) {
  const violations = [];
  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(entry?.[field])) {
      violations.push(`${label}: missing required field "${field}"`);
    }
  }
  return violations;
}

function checkSourceAndMethod(entry, label) {
  const violations = [];
  if (!VALID_SOURCES.has(entry?.source)) {
    violations.push(`${label}: "source" must be "generated" or "handwritten", got ${JSON.stringify(entry?.source)}`);
  }
  if (isNonEmptyString(entry?.method) && !VALID_METHODS.has(entry.method)) {
    violations.push(`${label}: "method" ${JSON.stringify(entry.method)} is not a valid HTTP method`);
  }
  return violations;
}

/** Rules (a) and (b) — the two hard-fail conditions R-A5 enforcement exists for. */
function checkGeneratedSourceRules(entry, label, generatedOperationIds) {
  if (entry?.source !== 'generated') return [];
  if (!isNonEmptyString(entry?.operationId)) {
    return [`${label}: source:generated but has no operationId (rule a)`];
  }
  if (!generatedOperationIds.has(entry.operationId)) {
    return [`${label}: source:generated with operationId "${entry.operationId}", which is not in the generated set (rule b)`];
  }
  return [];
}

/**
 * Validates one manifest entry. Returns a list of violation message
 * strings — empty means the entry is valid. `generatedOperationIds` is a
 * `Set<string>` of every operationId the CLI wrapper found actually
 * generated on disk (see `deriveOperationIdFromHookName`).
 */
export function validateManifestEntry(entry, generatedOperationIds) {
  const label = isNonEmptyString(entry?.id) ? entry.id : '(entry with no id)';
  return [
    ...checkRequiredFields(entry, label),
    ...checkSourceAndMethod(entry, label),
    ...checkGeneratedSourceRules(entry, label, generatedOperationIds),
  ];
}

/**
 * Validates every entry, plus whole-manifest structural checks (duplicate
 * ids). Returns `{ violations: [{id, messages}], duplicateIds: string[] }`.
 */
export function validateManifest(manifestDoc, generatedOperationIds) {
  const endpoints = Array.isArray(manifestDoc?.endpoints) ? manifestDoc.endpoints : [];
  const seenIds = new Map();
  const duplicateIds = new Set();
  const violations = [];

  for (const entry of endpoints) {
    const messages = validateManifestEntry(entry, generatedOperationIds);
    if (messages.length > 0) violations.push({ id: entry?.id ?? null, messages });

    if (isNonEmptyString(entry?.id)) {
      if (seenIds.has(entry.id)) duplicateIds.add(entry.id);
      seenIds.set(entry.id, true);
    }
  }

  return { violations, duplicateIds: [...duplicateIds], total: endpoints.length };
}

/**
 * orval's react-query hooks are always named `use` + PascalCase(operationId)
 * (verified empirically against the real generated tree: exact 1:1 match
 * across all 78 operations, zero exceptions). This is the inverse: recover
 * the operationId a hook name was generated from. Returns `null` for a name
 * that isn't a hook export (doesn't start with `use` + an uppercase letter).
 */
export function deriveOperationIdFromHookName(hookName) {
  if (typeof hookName !== 'string' || !/^use[A-Z]/.test(hookName)) return null;
  const rest = hookName.slice(3);
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

/**
 * The `Endpoint <METHOD> <path> (<opName>)` title convention P1's
 * parity/manifest/*.json API-* items use (mirrors
 * check-contract-coverage.mjs's `parseEndpointTitle`, kept independent
 * since the two scripts enforce different things and must not share a
 * silent coupling).
 */
export function parseParityApiTitle(title) {
  const m = /Endpoint\s+(\S+)\s+(\S+)\s*(?:\(([^)]*)\))?/.exec(title ?? '');
  return {
    method: (m?.[1] ?? '').toUpperCase(),
    path: m?.[2] ?? '',
    opName: m?.[3] ?? '',
  };
}

/**
 * Informational cross-reference (not a hard-fail source): for every parity
 * API-* item, does an endpoints.manifest.json entry with the SAME
 * operationId exist? Matches by operationId only (not path shape — that's
 * W2's check-contract-coverage.mjs's job and reproducing its normalisation
 * here would be exactly the "silent coupling" risk noted above). Returns
 * `{ matched: [{parityId, manifestId}], unmatched: [{parityId, opName}] }`.
 */
export function crossReferenceParity(parityItems, manifestEntries) {
  const byOperationId = new Map();
  for (const entry of manifestEntries) {
    if (isNonEmptyString(entry?.operationId)) byOperationId.set(entry.operationId, entry);
  }

  const matched = [];
  const unmatched = [];
  for (const item of parityItems) {
    const { opName } = parseParityApiTitle(item.title);
    const manifestEntry = opName ? byOperationId.get(opName) : undefined;
    if (manifestEntry) {
      matched.push({ parityId: item.id, manifestId: manifestEntry.id });
    } else {
      unmatched.push({ parityId: item.id, opName });
    }
  }
  return { matched, unmatched };
}
