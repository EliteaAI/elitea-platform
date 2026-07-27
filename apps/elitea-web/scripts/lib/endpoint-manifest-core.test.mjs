import { describe, expect, it } from 'vitest';

import {
  crossReferenceParity,
  deriveOperationIdFromHookName,
  parseParityApiTitle,
  validateManifest,
  validateManifestEntry,
} from './endpoint-manifest-core.mjs';

/** Table-driven coverage of every decision this module makes (unit S4, the
 * R-A5 enforcement mechanism — same rigor as W2's contract-coverage checker). */

const GENERATED = new Set(['listApplications', 'roleList', 'userList']);

describe('validateManifestEntry — rule (a): source:generated needs an operationId', () => {
  it('RED: source:generated with operationId null', () => {
    const violations = validateManifestEntry(
      { id: 'x.y', method: 'GET', path: '/x', operationId: null, source: 'generated' },
      GENERATED,
    );
    expect(violations).toContainEqual(expect.stringContaining('has no operationId (rule a)'));
  });

  it('RED: source:generated with operationId as an empty string', () => {
    const violations = validateManifestEntry(
      { id: 'x.y', method: 'GET', path: '/x', operationId: '  ', source: 'generated' },
      GENERATED,
    );
    expect(violations).toContainEqual(expect.stringContaining('rule a'));
  });

  it('GREEN: source:generated with a real operationId', () => {
    const violations = validateManifestEntry(
      { id: 'x.y', method: 'GET', path: '/x', operationId: 'roleList', source: 'generated' },
      GENERATED,
    );
    expect(violations).toEqual([]);
  });
});

describe('validateManifestEntry — rule (b): the operationId must be in the generated set', () => {
  it('RED: operationId not present in the generated set', () => {
    const violations = validateManifestEntry(
      { id: 'x.y', method: 'GET', path: '/x', operationId: 'thisDoesNotExist', source: 'generated' },
      GENERATED,
    );
    expect(violations).toContainEqual(expect.stringContaining('is not in the generated set (rule b)'));
  });

  it('GREEN: handwritten entries are exempt from rule (b) even with operationId null', () => {
    const violations = validateManifestEntry(
      { id: 'x.y', method: 'GET', path: '/x', operationId: null, source: 'handwritten' },
      GENERATED,
    );
    expect(violations).toEqual([]);
  });
});

describe('validateManifestEntry — structural checks (beyond rules a/b)', () => {
  it.each(['id', 'method', 'path'])('flags a missing required field: %s', (field) => {
    const entry = { id: 'x.y', method: 'GET', path: '/x', source: 'handwritten' };
    delete entry[field];
    const violations = validateManifestEntry(entry, GENERATED);
    expect(violations).toContainEqual(expect.stringContaining(`missing required field "${field}"`));
  });

  it('flags an invalid source value', () => {
    const violations = validateManifestEntry({ id: 'x.y', method: 'GET', path: '/x', source: 'bogus' }, GENERATED);
    expect(violations).toContainEqual(expect.stringContaining('"source" must be "generated" or "handwritten"'));
  });

  it('flags an invalid HTTP method', () => {
    const violations = validateManifestEntry(
      { id: 'x.y', method: 'TRACE', path: '/x', source: 'handwritten' },
      GENERATED,
    );
    expect(violations).toContainEqual(expect.stringContaining('is not a valid HTTP method'));
  });

  it('labels a violation on an entry with no id using the fallback label', () => {
    const violations = validateManifestEntry({ method: 'GET', path: '/x', source: 'bogus' }, GENERATED);
    expect(violations.every((v) => v.startsWith('(entry with no id):'))).toBe(true);
  });

  it('a fully valid handwritten entry has zero violations', () => {
    const violations = validateManifestEntry(
      { id: 'credentials.createSecret', method: 'POST', path: '/x', source: 'handwritten', operationId: null },
      GENERATED,
    );
    expect(violations).toEqual([]);
  });
});

describe('validateManifest — whole-document checks', () => {
  it('aggregates per-entry violations, keyed by id', () => {
    const doc = {
      endpoints: [
        { id: 'a', method: 'GET', path: '/a', source: 'generated', operationId: null },
        { id: 'b', method: 'GET', path: '/b', source: 'generated', operationId: 'roleList' },
      ],
    };
    const { violations, total } = validateManifest(doc, GENERATED);
    expect(total).toBe(2);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({ id: 'a', messages: expect.arrayContaining([expect.stringContaining('rule a')]) });
  });

  it('detects duplicate ids', () => {
    const doc = {
      endpoints: [
        { id: 'dup', method: 'GET', path: '/a', source: 'generated', operationId: 'roleList' },
        { id: 'dup', method: 'GET', path: '/b', source: 'generated', operationId: 'userList' },
      ],
    };
    expect(validateManifest(doc, GENERATED).duplicateIds).toEqual(['dup']);
  });

  it('a duplicate id counted more than twice appears once in duplicateIds', () => {
    const doc = {
      endpoints: [
        { id: 'dup', method: 'GET', path: '/a', source: 'generated', operationId: 'roleList' },
        { id: 'dup', method: 'GET', path: '/b', source: 'generated', operationId: 'userList' },
        { id: 'dup', method: 'GET', path: '/c', source: 'generated', operationId: 'listApplications' },
      ],
    };
    expect(validateManifest(doc, GENERATED).duplicateIds).toEqual(['dup']);
  });

  it('tolerates a document with no endpoints array at all', () => {
    expect(validateManifest({}, GENERATED)).toEqual({ violations: [], duplicateIds: [], total: 0 });
  });

  it('GREEN: an all-valid document has no violations and no duplicates', () => {
    const doc = {
      endpoints: [
        { id: 'a', method: 'GET', path: '/a', source: 'generated', operationId: 'roleList' },
        { id: 'b', method: 'POST', path: '/b', source: 'handwritten', operationId: null },
      ],
    };
    expect(validateManifest(doc, GENERATED)).toEqual({ violations: [], duplicateIds: [], total: 2 });
  });
});

describe('deriveOperationIdFromHookName', () => {
  it.each([
    ['useRoleList', 'roleList'],
    ['useListApplications', 'listApplications'],
    ['useGetBrandingBootstrap', 'getBrandingBootstrap'],
  ])('%s -> %s', (hookName, expected) => {
    expect(deriveOperationIdFromHookName(hookName)).toBe(expected);
  });

  it.each([
    ['usedByFeatures', null], // "use" + lowercase — not a hook per the "use[A-Z]" convention... actually 'usedByFeatures' has 'd' after use, lowercase, correctly null
    ['getRoleList', null], // doesn't start with "use"
    ['use', null], // nothing follows "use"
    [42, null],
    [undefined, null],
  ])('non-hook input %j -> null', (input, expected) => {
    expect(deriveOperationIdFromHookName(input)).toBe(expected);
  });
});

describe('parseParityApiTitle', () => {
  it('parses the standard "Endpoint METHOD path (opName)" title', () => {
    expect(parseParityApiTitle('Endpoint GET /admin/users/default/{projectId} (userList)')).toEqual({
      method: 'GET',
      path: '/admin/users/default/{projectId}',
      opName: 'userList',
    });
  });

  it('parses a title with a bracketed annotation after the parens', () => {
    expect(parseParityApiTitle('Endpoint GET /elitea_core/analytics/prompt_lib/{projectId}{expr} (projectAnalytics) [dynamic path template]')).toEqual({
      method: 'GET',
      path: '/elitea_core/analytics/prompt_lib/{projectId}{expr}',
      opName: 'projectAnalytics',
    });
  });

  it('tolerates a title with no parenthetical opName', () => {
    expect(parseParityApiTitle('Endpoint GET /x')).toEqual({ method: 'GET', path: '/x', opName: '' });
  });

  it('tolerates undefined/empty input', () => {
    expect(parseParityApiTitle(undefined)).toEqual({ method: '', path: '', opName: '' });
  });
});

describe('crossReferenceParity', () => {
  const manifestEntries = [
    { id: 'admin.roleList', operationId: 'roleList' },
    { id: 'admin.userList', operationId: 'userList' },
  ];

  it('matches a parity item by operationId parsed from its title', () => {
    const parityItems = [{ id: 'API-080', title: 'Endpoint GET /admin/users/default/{projectId} (userList)' }];
    const { matched, unmatched } = crossReferenceParity(parityItems, manifestEntries);
    expect(matched).toEqual([{ parityId: 'API-080', manifestId: 'admin.userList' }]);
    expect(unmatched).toEqual([]);
  });

  it('leaves an item with no matching manifest entry unmatched, with its parsed opName', () => {
    const parityItems = [{ id: 'API-999', title: 'Endpoint POST /nowhere (createNothing)' }];
    const { matched, unmatched } = crossReferenceParity(parityItems, manifestEntries);
    expect(matched).toEqual([]);
    expect(unmatched).toEqual([{ parityId: 'API-999', opName: 'createNothing' }]);
  });

  it('an item with no parenthetical opName is unmatched with an empty opName', () => {
    const parityItems = [{ id: 'API-998', title: 'Endpoint GET /x' }];
    const { unmatched } = crossReferenceParity(parityItems, manifestEntries);
    expect(unmatched).toEqual([{ parityId: 'API-998', opName: '' }]);
  });

  it('handles an empty parity item list', () => {
    expect(crossReferenceParity([], manifestEntries)).toEqual({ matched: [], unmatched: [] });
  });

  it('ignores manifest entries with no operationId when building the lookup', () => {
    const entries = [{ id: 'a', operationId: null }, { id: 'b', operationId: 'roleList' }];
    const parityItems = [{ id: 'API-001', title: 'Endpoint GET /x (roleList)' }];
    expect(crossReferenceParity(parityItems, entries).matched).toEqual([{ parityId: 'API-001', manifestId: 'b' }]);
  });
});
