/**
 * apps/elitea-ui/src/common/convertChatConversationMessages.js:21-33
 * `convertTime`, ported verbatim: normalises the persisted message-group
 * timestamp shapes into an ISO-parseable string —
 * `"YYYY-MM-DD HH:MM:SS"` (space-separated, Postgres-style) becomes
 * `"YYYY-MM-DDTHH:MM:SSZ"`; a string already ending in `Z` or already
 * carrying a `+` offset is returned as-is; anything else gets a bare `Z`
 * appended.
 */
export function convertTime(time: string): string {
  const timeStrings = time.split(' ');
  if (timeStrings.length > 1) {
    return `${timeStrings[0]}T${timeStrings[1]}Z`;
  }
  if (time.at(-1) === 'Z') {
    return time;
  }
  if (time.includes('+')) {
    return time;
  }
  return `${time}Z`;
}
