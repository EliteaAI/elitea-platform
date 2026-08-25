/**
 * Which (skill, version) a publish acts on, resolved from what the editor is
 * showing.
 *
 * In the feature rather than in `pages/skills/EditSkill.tsx`, where it started:
 * the answer is the publish surface's own rule, and a page that owns it is a
 * page that can get it wrong on its own — which is silent, because a publish
 * aimed at the wrong version looks identical on screen to one aimed at the
 * right one.
 */
import type { SkillRecord } from '../model/types';
import type { SkillPublishTarget } from '../model/useSkillPublishing';

/**
 * The status of the version the editor is showing.
 *
 * A skill version carries `status` ('draft' or 'published') since the
 * skill-publishing migration; a record from an older deployment carries none,
 * and that reads as 'draft' — the value the column defaults to — rather than as
 * "unknown", so the Publish control appears instead of silently vanishing.
 */
export function versionStatusOf(
  skill: SkillRecord | undefined,
  versionId: string | undefined,
): string | undefined {
  if (!skill) return undefined;
  const selected =
    versionId === undefined
      ? skill.version_details
      : skill.versions?.find((version) => String(version.id) === versionId);
  const status = (selected as { readonly status?: unknown } | undefined)?.status;
  return typeof status === 'string' && status ? status : 'draft';
}

/**
 * The (skill, version) a publish would act on.
 *
 * `params.version` is what the URL selects; when the route carries none the
 * editor is showing `version_details`, and that is the row the server would
 * publish too. Falling back to the FIRST version instead would publish
 * something other than what is on screen whenever the default version is not
 * first in the list.
 */
export function publishTargetOf(
  skill: SkillRecord | undefined,
  skillId: string | undefined,
  versionId: string | undefined,
): SkillPublishTarget {
  const resolved = Number(versionId ?? skill?.version_details?.id ?? Number.NaN);
  return {
    skillId: skillId === undefined ? undefined : Number(skillId),
    versionId: Number.isNaN(resolved) ? undefined : resolved,
    versionStatus: versionStatusOf(skill, versionId),
    versionNames: (skill?.versions ?? []).map((version) => version.name),
  };
}
