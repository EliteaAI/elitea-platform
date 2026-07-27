import { describe, expect, it } from 'vitest';

import { normaliseSkill, normaliseSkills, normaliseSkillsPage } from './normalise';
import type { SkillsPageWire, SkillWire } from '../model/types';

const wire: SkillWire = {
  id: 's1',
  project_id: 'p1',
  name: 'summarise-doc',
  description: 'Summarises a document',
  type: 'skill',
  config: { foo: 'bar' },
  is_default: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
};

describe('normaliseSkill', () => {
  it('maps snake_case wire fields to camelCase', () => {
    expect(normaliseSkill(wire)).toEqual({
      id: 's1',
      projectId: 'p1',
      name: 'summarise-doc',
      description: 'Summarises a document',
      type: 'skill',
      config: { foo: 'bar' },
      isDefault: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    });
  });

  it('preserves a false is_default rather than defaulting it — this is the wired repository\'s real, current value on every skill, not an edge case to special-case away', () => {
    expect(normaliseSkill({ ...wire, is_default: false }).isDefault).toBe(false);
  });

  it('passes the zero-sentinel updated_at through unchanged rather than "fixing" it — repos/skills.go never scans UpdatedAt', () => {
    const zeroSentinel = '0001-01-01T00:00:00Z';
    expect(normaliseSkill({ ...wire, updated_at: zeroSentinel }).updatedAt).toBe(zeroSentinel);
  });

  it('passes the literal type "skill" through unchanged rather than inferring or overriding it', () => {
    expect(normaliseSkill(wire).type).toBe('skill');
  });

  it('omits description when the wire elided it (omitempty), rather than adding an undefined key', () => {
    const { description: _description, ...wireWithoutDescription } = wire;
    const skill = normaliseSkill(wireWithoutDescription);
    expect('description' in skill).toBe(false);
  });

  it('omits config when the wire elided it — the wired repository never populates it', () => {
    const { config: _config, ...wireWithoutConfig } = wire;
    const skill = normaliseSkill(wireWithoutConfig);
    expect('config' in skill).toBe(false);
  });
});

describe('normaliseSkills', () => {
  it('maps every entry in order', () => {
    const second: SkillWire = { ...wire, id: 's2', name: 'translate-doc' };
    expect(normaliseSkills([wire, second]).map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('returns an empty array for an empty input', () => {
    expect(normaliseSkills([])).toEqual([]);
  });
});

describe('normaliseSkillsPage', () => {
  const pageWire: SkillsPageWire = {
    items: [wire],
    total: 1,
    page: 1,
    page_size: 20,
    total_pages: 1,
  };

  it('camelCases the pagination envelope and normalises every item', () => {
    expect(normaliseSkillsPage(pageWire)).toEqual({
      items: [
        {
          id: 's1',
          projectId: 'p1',
          name: 'summarise-doc',
          description: 'Summarises a document',
          type: 'skill',
          config: { foo: 'bar' },
          isDefault: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  });

  it('normalises an empty items list to an empty array', () => {
    expect(normaliseSkillsPage({ ...pageWire, items: [] }).items).toEqual([]);
  });
});
