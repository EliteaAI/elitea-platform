/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/conversation-list/lib/
 * constants/conversationList.constants.js:1-5` (unit C2). `DATE_GROUP_ORDER`/
 * `DEFAULT_EXPANDED_GROUP` (the baseline file's other two exports) are
 * DELIBERATELY not re-declared here — `entities/folder/model/selectors.ts`
 * already exports both (landed by the prior C2 API-layer phase of this same
 * pipeline), so this feature imports them from there instead of duplicating
 * them.
 */

export const DATE_GROUP_DISPLAY_NAMES = {
  today: 'Today',
  this_week: 'This Week',
  older: 'Older',
} as const;
