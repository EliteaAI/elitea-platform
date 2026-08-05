import type { Skill, SkillsPage, SkillsPageWire, SkillWire } from '../model/types';

/**
 * snake_case wire shape -> camelCase `Skill` domain type
 * (`SkillWire`/`Skill`, see model/types.ts for the evidence trail).
 *
 * Maps the degenerate fields through FAITHFULLY rather than "fixing" them:
 * `type` stays whatever the wire sent (always the literal `"skill"` today),
 * `isDefault` stays whatever the wire sent (always `false` today), and
 * `updatedAt` stays whatever the wire sent (always the Go zero-value
 * sentinel `"0001-01-01T00:00:00Z"` today) — these are real, current
 * backend behaviours, not normalisation bugs to paper over.
 */
export function normaliseSkill(wire: SkillWire): Skill {
  return {
    id: wire.id,
    projectId: wire.project_id,
    name: wire.name,
    ...(wire.description !== undefined ? { description: wire.description } : {}),
    type: wire.type,
    ...(wire.config !== undefined ? { config: wire.config } : {}),
    isDefault: wire.is_default,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
  };
}

export function normaliseSkills(wire: readonly SkillWire[]): Skill[] {
  return wire.map(normaliseSkill);
}

/**
 * `SkillsList` envelope (`SkillsPageWire`) -> `SkillsPage`: camelCases the
 * pagination fields and normalises every item.
 */
export function normaliseSkillsPage(wire: SkillsPageWire): SkillsPage {
  return {
    items: normaliseSkills(wire.items),
    total: wire.total,
    page: wire.page,
    pageSize: wire.page_size,
    totalPages: wire.total_pages,
  };
}
