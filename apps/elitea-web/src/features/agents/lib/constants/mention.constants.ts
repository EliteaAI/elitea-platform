/**
 * Ported from `apps/elitea-ui/src/[fsd]/shared/lib/constants/mention.constants.js`
 * (byte-for-byte: `MentionPhase`, `SLASH_TRIGGER`, `SKILL_TRIGGER`).
 *
 * **Placement (disclosed, not a promotion):** the baseline keeps this file in
 * `shared/lib/`, but this app's `shared/lib/**` is unit S3's owned surface,
 * not this sub-unit's (A1b). Nothing in `shared/lib/**` exports a mention
 * constants module today (verified: `grep -rl MentionConstants shared/`
 * returns nothing), and only `features/agents`' own instructions-mention
 * hooks (`useInstructionsSlashCommand`, `useInstructionsTildaCommand`,
 * `useInstructionsMention`, `useInstructionsSkillMention` — all four in this
 * sub-unit's owned-file list) consume it. Kept feature-local rather than
 * reaching into a slice this unit does not own; promote to `shared/lib` if a
 * future consumer outside `features/agents` needs it.
 */

/** Phase of the active "/" or "~" mention state machine in the instructions textarea. */
export const MentionPhase = {
  Idle: 'idle',
  Items: 'items',
  Tools: 'tools',
} as const;

export type MentionPhaseValue = (typeof MentionPhase)[keyof typeof MentionPhase];

/** Trigger characters that start an instructions mention. */
export const SLASH_TRIGGER = '/';
export const SKILL_TRIGGER = '~';
