/**
 * Query-param key / URL-token constants ported from
 * apps/elitea-ui/src/common/constants.js (unit S3, spec §9.3).
 *
 * These are the literal string KEYS many features read/write on
 * `URLSearchParams`. Route-level query-param BEHAVIOUR (which params exist,
 * their validation, defaults) is tracked as PARAM-* items in P1's manifest
 * (`apps/elitea-web/parity/manifest/*.json`) and owned by unit R1's
 * `validateSearch` schemas — this file only carries the raw key strings so
 * non-router feature code has a single source for them too. Cross-checked:
 * P1's manifest already tracks e.g. `viewMode` as PARAM-* items; this file
 * does not duplicate that tracking, just the literal constant.
 */

/** `constants.js:279-307`. */
export const SearchParams = {
  ViewMode: 'viewMode',
  Name: 'name',
  Statuses: 'statuses',
  SortOrder: 'sort_order',
  SortBy: 'sort_by',
  AuthorId: 'author_id',
  AuthorName: 'author_name',
  PageSize: 'page_size',
  View: 'view',
  IntegrationName: 'integration_name',
  DeploymentConfigName: 'config_name',
  CreateConversation: 'create',
  Conversation: 'conversation',
  MessageId: 'message_id',
  DestTab: 'destTab',
  ToolkitType: 'toolkit_type',
  SaveToolkit: 'save_toolkit',
  SourceApplicationId: 'source_application_id',
  ReturnUrl: 'return_url',
  Types: 'types',
  EditedParticipantId: 'edited_participant_id',
  IsMCP: 'mcp',
  IndexName: 'index_name',
  HistoryRunId: 'history_run_id',
  SharedChat: 'shared_chat',
  Bucket: 'bucket',
  SharedBucket: 'shared_bucket',
} as const;

export const URL_PARAMS_KEY_TAGS = 'tags[]';
export const GROUP_SELECT_VALUE_SEPARATOR = '::::';
