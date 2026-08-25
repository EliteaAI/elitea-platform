/**
 * The two pure decisions the skills page makes about publishing: which tab a
 * URL means, and which (skill, version) a publish would act on.
 *
 * Both are asserted directly because both are silent when wrong — a publish
 * aimed at the wrong version looks identical on screen to one aimed at the
 * right one.
 */
import { describe, expect, it } from 'vitest';

import { publishTargetOf, versionStatusOf } from '../EditSkill';
import { SKILL_TABS, resolveSkillTab } from '../Skills';

const skill = {
  id: 'skill-1',
  name: 'Reviewer',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  owner_id: '1',
  version_details: { id: 11, name: 'base', instructions: '', tags: [], status: 'draft' },
  versions: [
    { id: 11, name: 'base', instructions: '', tags: [], status: 'draft' },
    { id: 12, name: 'v1.0', instructions: '', tags: [], status: 'published' },
  ],
} as unknown as Parameters<typeof publishTargetOf>[0];

describe('resolveSkillTab', () => {
  it('resolves anything but "public" to the project list', () => {
    expect(SKILL_TABS).toEqual(['all', 'public']);
    expect(resolveSkillTab('public')).toBe('public');
    expect(resolveSkillTab('all')).toBe('all');
    // An old link, or a segment from a tab that no longer exists, lands on the
    // list rather than on a blank screen.
    expect(resolveSkillTab('latest')).toBe('all');
    expect(resolveSkillTab(undefined)).toBe('all');
  });
});

describe('publishTargetOf', () => {
  it('targets the version the URL selects', () => {
    expect(publishTargetOf(skill, 'skill-1', '12')).toEqual({
      skillId: Number('skill-1'),
      versionId: 12,
      versionStatus: 'published',
      versionNames: ['base', 'v1.0'],
    });
  });

  it('falls back to version_details, not to the first version in the list', () => {
    const target = publishTargetOf(skill, '7', undefined);
    expect(target.versionId).toBe(11);
    expect(target.versionStatus).toBe('draft');
  });

  it('reads a version with no status as a draft', () => {
    // The status column arrived with the skill-publishing migration; a record
    // from before it must still offer the Publish control rather than silently
    // hiding it.
    expect(versionStatusOf({ version_details: { id: 1, name: 'base' } } as never, undefined)).toBe(
      'draft',
    );
    expect(versionStatusOf(undefined, undefined)).toBeUndefined();
  });
});
