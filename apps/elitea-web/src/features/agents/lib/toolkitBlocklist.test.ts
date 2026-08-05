import { describe, expect, it } from 'vitest';

import { getToolkitTypeLabel, isToolkitTypeBlocked } from './toolkitBlocklist';

describe('isToolkitTypeBlocked', () => {
  it('is false when the blocklist is undefined', () => {
    expect(isToolkitTypeBlocked('github', undefined)).toBe(false);
  });

  it('is false when the blocklist is empty', () => {
    expect(isToolkitTypeBlocked('github', [])).toBe(false);
  });

  it('is false when type is undefined', () => {
    expect(isToolkitTypeBlocked(undefined, ['github'])).toBe(false);
  });

  it('matches an exact type on the blocklist', () => {
    expect(isToolkitTypeBlocked('github', ['github', 'jira'])).toBe(true);
  });

  it('is case-insensitive and separator-insensitive (GitHub / git_hub / github collapse)', () => {
    expect(isToolkitTypeBlocked('GitHub', ['git_hub'])).toBe(true);
    expect(isToolkitTypeBlocked('git-hub', ['GITHUB'])).toBe(true);
  });

  it('does not match an unrelated type', () => {
    expect(isToolkitTypeBlocked('jira', ['github'])).toBe(false);
  });
});

describe('getToolkitTypeLabel', () => {
  it('capitalises the first letter of a type', () => {
    expect(getToolkitTypeLabel('github')).toBe('Github');
  });

  it('trims surrounding whitespace before capitalising', () => {
    expect(getToolkitTypeLabel('  jira  ')).toBe('Jira');
  });

  it('falls back to "Toolkit" for empty/undefined/non-string input', () => {
    expect(getToolkitTypeLabel(undefined)).toBe('Toolkit');
    expect(getToolkitTypeLabel('')).toBe('Toolkit');
    expect(getToolkitTypeLabel('   ')).toBe('Toolkit');
  });
});
