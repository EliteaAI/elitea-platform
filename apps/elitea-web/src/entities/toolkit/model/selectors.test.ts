import { describe, expect, it } from 'vitest';

import { isMcpToolkit, isOnlineToolkit, sortToolkitsByName, toolkitDisplayName } from './selectors';
import type { Toolkit } from './types';

const toolkit = (overrides: Partial<Toolkit> = {}): Toolkit => ({
  id: '1',
  name: '',
  type: 'github',
  ...overrides,
});

describe('toolkitDisplayName', () => {
  it('uses the name when present', () => {
    expect(toolkitDisplayName(toolkit({ name: 'My GitHub' }))).toBe('My GitHub');
  });

  it('falls back to toolkit_name when name is blank', () => {
    expect(toolkitDisplayName(toolkit({ name: '', ...({ toolkit_name: 'My Jira' } as Partial<Toolkit>) }))).toBe('My Jira');
  });

  it('falls back to settings.elitea_title', () => {
    expect(toolkitDisplayName(toolkit({ settings: { elitea_title: 'Custom Title' } }))).toBe('Custom Title');
  });

  it('falls back to settings.configuration_title when elitea_title is absent', () => {
    expect(toolkitDisplayName(toolkit({ settings: { configuration_title: 'Config Title' } }))).toBe('Config Title');
  });

  it('falls back to a capitalized type when nothing else is present', () => {
    expect(toolkitDisplayName(toolkit({ type: 'jira' }))).toBe('Jira');
  });

  it('skips a present-but-empty-string toolkit_name and falls through to the next fallback (falsy-coalescing, not nullish-only)', () => {
    expect(
      toolkitDisplayName(
        toolkit({
          name: '',
          settings: { elitea_title: 'Real Title' },
          ...({ toolkit_name: '' } as Partial<Toolkit>),
        }),
      ),
    ).toBe('Real Title');
  });
});

describe('isMcpToolkit', () => {
  it('is true for the exact "mcp" type', () => {
    expect(isMcpToolkit(toolkit({ type: 'mcp' }))).toBe(true);
  });

  it('is true for a "mcp_*" pre-built type', () => {
    expect(isMcpToolkit(toolkit({ type: 'mcp_github' }))).toBe(true);
  });

  it('is true when meta.mcp is exactly true', () => {
    expect(isMcpToolkit(toolkit({ type: 'custom', meta: { mcp: true } }))).toBe(true);
  });

  it('is false for an unrelated type with no mcp meta flag', () => {
    expect(isMcpToolkit(toolkit({ type: 'github' }))).toBe(false);
  });

  it('is false when meta.mcp is present but not true', () => {
    expect(isMcpToolkit(toolkit({ type: 'custom', meta: { mcp: 'yes' } }))).toBe(false);
  });
});

describe('isOnlineToolkit', () => {
  it('is true only when online is exactly true', () => {
    expect(isOnlineToolkit(toolkit({ online: true }))).toBe(true);
    expect(isOnlineToolkit(toolkit({ online: false }))).toBe(false);
    expect(isOnlineToolkit(toolkit())).toBe(false);
  });
});

describe('sortToolkitsByName', () => {
  it('sorts using the display-name fallback chain', () => {
    const list = [toolkit({ id: 'a', name: 'zeta' }), toolkit({ id: 'b', type: 'jira' })];
    expect(sortToolkitsByName(list).map((t) => t.id)).toEqual(['b', 'a']);
  });
});
