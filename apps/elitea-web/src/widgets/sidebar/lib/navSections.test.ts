import { describe, expect, it, vi } from 'vitest';

import { computeIsSelectedProjectPublic, navSections, selectedNavItem, visibleNavSections } from './navSections';

vi.mock('@/shared/config', () => ({
  getConfig: vi.fn(() => ({ status: 'ok', config: { vite_public_project_id: '999' } })),
}));

vi.mock('@/entities/project', () => ({
  isPublicProject: (id: string, publicId: string) => id === publicId,
}));

describe('navSections', () => {
  it('returns 3 groups', () => {
    expect(navSections()).toHaveLength(3);
  });

  it('first section has chat, agents, pipelines', () => {
    const first = navSections()[0].items;
    expect(first.map((i) => i.value)).toEqual(['chat', 'agents', 'pipelines']);
  });

  it('all items have url starting with /', () => {
    navSections().flatMap((s) => s.items).forEach((item) => {
      expect(item.url).toMatch(/^\//);
    });
  });
});

describe('visibleNavSections', () => {
  const sections = navSections();
  const allPermissions = new Set([
    'models.chat.folders.get',
    'models.applications.public_applications.list',
    'models.applications.tools.list',
    'configuration.artifacts.artifacts.view',
  ]);

  it('shows all items when user has all permissions', () => {
    const result = visibleNavSections(sections, allPermissions);
    const values = result.flatMap((s) => s.items.map((i) => i.value));
    expect(values).toContain('chat');
    expect(values).toContain('agents');
    expect(values).toContain('skills');
    expect(values).toContain('artifacts');
  });

  it('hides skills when project is public', () => {
    const result = visibleNavSections(sections, allPermissions, { isSelectedProjectPublic: true });
    const values = result.flatMap((s) => s.items.map((i) => i.value));
    expect(values).not.toContain('skills');
  });

  it('filters items by permission — empty set hides gated items', () => {
    const result = visibleNavSections(sections, new Set());
    const values = result.flatMap((s) => s.items.map((i) => i.value));
    expect(values).toContain('skills');
    expect(values).toContain('applications');
    expect(values).not.toContain('agents');
    expect(values).not.toContain('pipelines');
  });

  it('drops empty sections entirely', () => {
    const result = visibleNavSections(sections, new Set());
    result.forEach((section) => {
      expect(section.items.length).toBeGreaterThan(0);
    });
  });
});

describe('computeIsSelectedProjectPublic', () => {
  it('returns true when id matches public project id from config', () => {
    expect(computeIsSelectedProjectPublic('999')).toBe(true);
  });

  it('returns false for non-public id', () => {
    expect(computeIsSelectedProjectPublic('123')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(computeIsSelectedProjectPublic(undefined)).toBe(false);
  });
});

describe('selectedNavItem', () => {
  const items = navSections().flatMap((s) => s.items);

  it('returns matching item for /chat path', () => {
    expect(selectedNavItem('/chat', items)).toBe('chat');
    expect(selectedNavItem('/chat/conv-123', items)).toBe('chat');
  });

  it('returns agents for /agents path', () => {
    expect(selectedNavItem('/agents', items)).toBe('agents');
    expect(selectedNavItem('/agents/create', items)).toBe('agents');
  });

  it('returns undefined for /agents-hub', () => {
    expect(selectedNavItem('/agents-hub', items)).toBeUndefined();
  });

  it('returns undefined for unrecognized path', () => {
    expect(selectedNavItem('/unknown', items)).toBeUndefined();
  });

  it('matches toolkits, credentials, artifacts', () => {
    expect(selectedNavItem('/toolkits/edit', items)).toBe('toolkits');
    expect(selectedNavItem('/credentials', items)).toBe('credentials');
    expect(selectedNavItem('/artifacts/list', items)).toBe('artifacts');
  });
});
