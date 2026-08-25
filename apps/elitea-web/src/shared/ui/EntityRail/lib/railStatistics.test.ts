import { describe, expect, it } from 'vitest';

import { railStatForKind, railStatForPath, railStatRoutePrefixes, resolveRailStat } from './railStatistics';

/**
 * The route-prefix -> statistic mapping, asserted against
 * `apps/elitea-ui/src/[fsd]/entities/author/lib/constants/
 * statistics.constants.js:9-29` field by field.
 */
describe('railStatForPath', () => {
  it('maps /agents to total_applications + public_applications', () => {
    expect(railStatForPath('/agents/latest')).toEqual({
      kind: 'agents',
      valueKey: 'total_applications',
      publishedKey: 'public_applications',
    });
  });

  it('maps /skills to total_skills + public_skills', () => {
    expect(railStatForPath('/skills')).toEqual({ kind: 'skills', valueKey: 'total_skills', publishedKey: 'public_skills' });
  });

  it('maps /pipelines to total_pipelines with NO published row', () => {
    const descriptor = railStatForPath('/pipelines/all');
    expect(descriptor).toEqual({ kind: 'pipelines', valueKey: 'total_pipelines' });
    expect(descriptor?.publishedKey).toBeUndefined();
  });

  it('maps /toolkits to total_toolkits with NO published row', () => {
    const descriptor = railStatForPath('/toolkits/all');
    expect(descriptor).toEqual({ kind: 'toolkits', valueKey: 'total_toolkits' });
    expect(descriptor?.publishedKey).toBeUndefined();
  });

  it('matches by PREFIX, so every nested route under a domain keeps its statistic', () => {
    expect(railStatForPath('/agents/latest/42/v1')?.kind).toBe('agents');
  });

  it('returns undefined for a route the baseline map has no entry for', () => {
    for (const pathname of ['/mcps/all', '/credentials/all', '/user-public/agents', '/', '/apps/catalog']) {
      expect(railStatForPath(pathname)).toBeUndefined();
    }
  });

  it('does not match a path that merely CONTAINS a mapped prefix', () => {
    expect(railStatForPath('/user-public/agents')).toBeUndefined();
  });

  it('exposes exactly the four baseline prefixes', () => {
    expect(railStatRoutePrefixes()).toEqual(['/agents', '/skills', '/pipelines', '/toolkits']);
  });
});

describe('railStatForKind', () => {
  it('returns the same descriptor the prefix lookup does', () => {
    expect(railStatForKind('skills')).toEqual(railStatForPath('/skills'));
    expect(railStatForKind('pipelines')).toEqual(railStatForPath('/pipelines'));
  });
});

describe('resolveRailStat', () => {
  const counts = {
    total_applications: 7,
    public_applications: 3,
    total_pipelines: 5,
    total_toolkits: 2,
    total_skills: 11,
    public_skills: 4,
  };

  it('reads the descriptor fields off the author detail', () => {
    expect(resolveRailStat(railStatForKind('agents'), counts)).toEqual({ kind: 'agents', value: 7, published: 3 });
    expect(resolveRailStat(railStatForKind('skills'), counts)).toEqual({ kind: 'skills', value: 11, published: 4 });
  });

  it('omits `published` entirely for a descriptor with no publishedKey', () => {
    expect(resolveRailStat(railStatForKind('pipelines'), counts)).toEqual({ kind: 'pipelines', value: 5 });
    expect(resolveRailStat(railStatForKind('toolkits'), counts)).toEqual({ kind: 'toolkits', value: 2 });
  });

  it('reads an absent count as 0 (the server omits zero-valued counts)', () => {
    expect(resolveRailStat(railStatForKind('agents'), {})).toEqual({ kind: 'agents', value: 0, published: 0 });
  });

  it('keeps a real 0 distinguishable from "this route has no published row"', () => {
    expect(resolveRailStat(railStatForKind('agents'), { total_applications: 1 }).published).toBe(0);
    expect(resolveRailStat(railStatForKind('pipelines'), { total_pipelines: 1 }).published).toBeUndefined();
  });
});
