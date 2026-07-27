/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { Skill, SkillsPage, SkillsPageWire, SkillWire } from './model/types';
export { filterSkillsByQuery, skillDescription, sortSkillsByName } from './model/selectors';
export { normaliseSkill, normaliseSkills, normaliseSkillsPage } from './lib/normalise';
