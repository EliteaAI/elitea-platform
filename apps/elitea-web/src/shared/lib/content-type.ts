/**
 * Card/list content-type discriminant ported from
 * apps/elitea-ui/src/common/constants.js:434-471 (unit S3, spec §9.3).
 *
 * The old app's classification helpers (`isApplicationCard`, `isPipelineCard`,
 * etc. in `src/common/checkCardType.js`) are NOT ported here: that file is
 * not one of S3's two porting targets (`utils.jsx` + `constants.js`), and
 * `utils.jsx`'s `getEntityTypeByCardType`/`getEntityType` (which consume it)
 * are skipped for the same cross-scope reason — see the S3 report.
 */
export const ContentType = {
  MyLibraryAll: 'MyLibraryAll',
  MyLibraryApplications: 'MyLibraryApplications',
  UserPublicAll: 'UserPublicAll',
  UserPublicApplications: 'UserPublicApplications',
  UserPublicPipelines: 'UserPublicPipelines',
  UserPublicToolkits: 'UserPublicToolkits',
  UserPublicMCPs: 'UserPublicMCPs',
  ApplicationTop: 'ApplicationTop',
  ApplicationLatest: 'ApplicationLatest',
  ApplicationMyLiked: 'ApplicationMyLiked',
  ApplicationTrending: 'ApplicationTrending',
  ApplicationAdmin: 'ApplicationAdmin',
  ApplicationAll: 'ApplicationAll',
  ApplicationDraft: 'ApplicationDraft',
  ApplicationPublished: 'ApplicationPublished',
  ApplicationModeration: 'ApplicationModeration',
  ApplicationApproval: 'ApplicationApproval',
  ApplicationRejected: 'ApplicationRejected',
  PipelineTop: 'PipelineTop',
  PipelineLatest: 'PipelineLatest',
  PipelineMyLiked: 'PipelineMyLiked',
  PipelineTrending: 'PipelineTrending',
  PipelineAdmin: 'PipelineAdmin',
  PipelineAll: 'PipelineAll',
  PipelineDraft: 'PipelineDraft',
  PipelinePublished: 'PipelinePublished',
  PipelineModeration: 'PipelineModeration',
  PipelineApproval: 'PipelineApproval',
  PipelineRejected: 'PipelineRejected',
  ToolkitAdmin: 'ToolkitAdmin',
  ToolkitAll: 'ToolkitAll',
  AppAll: 'AppAll',
  MCPAdmin: 'MCPAdmin',
  MCPAll: 'MCPAll',
  CredentialAll: 'CredentialAll',
  SkillAll: 'SkillAll',
} as const;

/** @public Wave-1 surface: type-only, for Wave-2 card/list features to type their `contentType` prop against. */
export type ContentTypeValue = (typeof ContentType)[keyof typeof ContentType];
