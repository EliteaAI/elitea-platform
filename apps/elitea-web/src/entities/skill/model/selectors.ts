import type { Skill } from './types';

/** Alphabetical name sort, case-insensitive — the common list-ordering pattern. */
export function sortSkillsByName(skills: readonly Skill[]): Skill[] {
  return [...skills].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** Case-insensitive substring filter over skill names. */
export function filterSkillsByQuery(skills: readonly Skill[], query: string): Skill[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...skills];
  return skills.filter((skill) => skill.name.toLowerCase().includes(needle));
}

/**
 * Display description with a fallback — `description` is `omitempty` on the
 * wire (v2.yaml:1863) and frequently absent.
 */
export function skillDescription(skill: Skill): string {
  return skill.description ?? '';
}
