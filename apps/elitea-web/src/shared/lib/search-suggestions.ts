/**
 * Search-autosuggest constants ported from
 * apps/elitea-ui/src/common/constants.js:618-629 (unit S3, spec §9.3).
 * `AutoSuggestionTitles` values are user-visible copy (see S3 report re: S8).
 */
export const AutoSuggestionTypes = ['tag', 'application', 'pipeline', 'toolkit', 'skill'] as const;

export const AutoSuggestionTitles = {
  TOP: 'Top Search Requests',
  TAGS: 'Tags',
  AGENTS: 'Agents',
  PIPELINES: 'Pipelines',
  TOOLKITS: 'Toolkits',
  CREDENTIALS: 'Credentials',
  MCPs: 'MCPs',
  SKILLS: 'Skills',
} as const;
