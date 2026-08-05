/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/shared/lib/constants/mention.constants.js`
 * (`MentionPhase`/`SKILL_TRIGGER` — `SLASH_TRIGGER` is NOT ported here, see
 * below).
 *
 * **Deliberate duplicate, not a promotion — mirrors an already-landed
 * sibling copy.** `features/agents/lib/constants/mention.constants.ts`
 * ported the same baseline file first (Wave-2 unit A1b) and left its own
 * doc comment explaining why it stayed feature-local rather than promoted
 * to `shared/lib` ("only this sub-unit's four instructions-mention hooks
 * consume it today ... promote to `shared/lib` if a future consumer
 * outside `features/agents` needs it"). This unit (`features/chat-input`,
 * Wave-2 unit C3) IS exactly that future consumer — `useChatSkillMention`
 * below needs `MentionPhase.{Idle,Items}`/`SKILL_TRIGGER` for its own "~"
 * state machine — but `features/chat-input` may not import
 * `features/agents` (`no-sideways-features`), so the fix is the same one
 * `features/agents`' own copy already documents as acceptable: a second,
 * independent duplicate here, flagged as a promotion candidate for a
 * future cleanup pass rather than promoted as a silent side effect of this
 * build. This mirrors the OLD app's own precedent of tolerating exactly
 * this kind of duplication (see `../utils/instructionsMention.utils.ts`'s
 * doc comment for the fuller version of this argument).
 *
 * `SLASH_TRIGGER` is deliberately NOT duplicated: `useSlashCommandHandler`
 * (this slice's "/" toolkit-tool mention) is a wholly independent, new
 * chat-local implementation with its own local `SlashPhase` union
 * (`'idle' | 'toolkit' | 'tool'`, distinct from `MentionPhase`) and detects
 * the `/` character as a literal, exactly like the baseline's own
 * `useSlashCommandHandler.hooks.js` does — it never imported
 * `MentionConstants` at all (confirmed: that file has zero import from
 * `shared/lib/constants`). Only `SKILL_TRIGGER`/`MentionPhase` — the two
 * symbols the ported `useChatSkillMention.hooks.js` actually reads — are
 * duplicated below, matching the "2-3 constants it needs" scope.
 */

/** Phase of the active "~" skill-mention state machine in the chat input. Only `Idle`/`Items` are reachable here (`Tools` is a `MentionPhase` value the instructions-mention system uses for its two-level toolkit/tool flow; this feature's "~" mention is single-level). */
export const MentionPhase = {
  Idle: 'idle',
  Items: 'items',
  Tools: 'tools',
} as const;

export type MentionPhaseValue = (typeof MentionPhase)[keyof typeof MentionPhase];

/** Trigger character that starts a "~" skill mention. */
export const SKILL_TRIGGER = '~';
