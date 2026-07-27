import { describe, expect, it } from 'vitest';

import { PERMISSION_GROUPS } from '@/shared/lib/permissions';

import { navSections, selectedNavItem, visibleNavSections } from '../lib/navSections';

describe('navSections (SHELL-001..009)', () => {
  it('lists exactly the 9 items across 3 groups, in old-app order', () => {
    const sections = navSections();
    expect(sections).toHaveLength(3);
    expect(sections[0]?.items.map((i) => i.value)).toEqual(['chat', 'agents', 'pipelines']);
    expect(sections[1]?.items.map((i) => i.value)).toEqual([
      'skills',
      'toolkits',
      'mcps',
      'credentials',
      'applications',
    ]);
    expect(sections[2]?.items.map((i) => i.value)).toEqual(['artifacts']);
  });
});

describe('visibleNavSections (SHELL-010)', () => {
  it('keeps every item when every required permission is held', () => {
    const all = new Set(Object.values(PERMISSION_GROUPS).flat());
    const visible = visibleNavSections(navSections(), all);
    const totalItems = visible.reduce((count, section) => count + section.items.length, 0);
    expect(totalItems).toBe(9);
  });

  it('drops a gated item whose permission is missing, without dropping ungated siblings', () => {
    // No permissions at all: chat/agents/pipelines/credentials/toolkits/artifacts/mcps
    // are all gated (mcps reuses the toolkits group) and disappear; skills and
    // applications have no PERMISSION_GROUPS entry and always survive.
    const visible = visibleNavSections(navSections(), new Set());
    const values = visible.flatMap((section) => section.items.map((item) => item.value));
    expect(values).toEqual(['skills', 'applications']);
  });

  it('drops an entire EMPTY section object, not just its (already-filtered) items', () => {
    const visible = visibleNavSections(navSections(), new Set());
    // Groups 1 (chat/agents/pipelines) and 3 (artifacts) are entirely
    // gated; only group 2 survives, and only via its two UNGATED items
    // (skills, applications — neither has a PERMISSION_GROUPS entry). The
    // section itself must be removed from the array (1 section left, not 3
    // with two holding an empty `items: []`) — proven by asserting NO
    // section has an empty items array, not merely that 'chat' is absent
    // from the flattened item list (a mutation that drops item-level
    // filtering but leaves stray empty sections would still pass that
    // weaker check).
    expect(visible).toHaveLength(1);
    expect(visible.every((section) => section.items.length > 0)).toBe(true);
    expect(visible.some((section) => section.items.some((item) => item.value === 'chat'))).toBe(false);
  });

  it('grants a gated item when its permission is held', () => {
    const visible = visibleNavSections(navSections(), new Set(PERMISSION_GROUPS.chat));
    expect(visible.flatMap((s) => s.items.map((i) => i.value))).toContain('chat');
  });
});

describe('selectedNavItem', () => {
  it('matches the item whose url is a prefix of the pathname', () => {
    const items = navSections()[0]?.items ?? [];
    expect(selectedNavItem('/chat/abc-123', items)).toBe('chat');
    expect(selectedNavItem('/agents/latest/agent-1', items)).toBe('agents');
  });

  it('never matches /agents-hub (old app: explicit early-return)', () => {
    const items = navSections()[0]?.items ?? [];
    expect(selectedNavItem('/agents-hub', items)).toBeUndefined();
  });

  it('returns undefined for a pathname matching no nav item', () => {
    const items = navSections()[0]?.items ?? [];
    expect(selectedNavItem('/mode-switch', items)).toBeUndefined();
  });
});
