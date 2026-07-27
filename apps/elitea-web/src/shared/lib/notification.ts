/**
 * Notification-type enum ported from
 * apps/elitea-ui/src/common/constants.js:997-1021 (unit S3, spec §9.3).
 */
export const NotificationType = {
  ModeratorUnpublish: 'moderator_unpublish',
  AuthorApproval: 'author_approval',
  AuthorReject: 'author_reject',
  ModeratorApprovalOfVersion: 'moderator_approval_of_version',
  ModeratorRejectOfVersion: 'moderator_reject_of_version',
  TokenExpiring: 'token_expiring',
  TokenIsExpired: 'token_is_expired',
  SpendingLimitExpiring: 'spending_limit_expiring',
  SpendingLimitIsExpired: 'spending_limit_is_expired',
  Rates: 'rates',
  Comments: 'comments',
  RewardNewLevel: 'reward_new_level',
  ContributorRequestForPublishApprove: 'contributor_request_for_publish_approve',
  UserWasAddedToSomeProjectAsTeammate: 'user_was_added_to_some_project_as_teammate',
  ChatUserAdded: 'chat_user_added',
  ChatUserMentioned: 'chat_user_mentioned',
  PrivateProjectCreated: 'private_project_created',
  IndexDataChanged: 'index_data_changed',
  BucketExpirationWarning: 'bucket_expiration_warning',
  AgentUnpublished: 'agent_unpublished',
  PersonalAccessTokenExpiring: 'personal_access_token_expiring',
  ModerationRejected: 'moderation_rejected',
  ModerationApproved: 'moderation_approved',
} as const;
