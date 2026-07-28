/**
 * Ported byte-for-byte from `apps/elitea-ui/src/[fsd]/features/sharepoint/
 * lib/helpers/token.helpers.js` (5 lines, Wave-2 unit A4e). Builds the
 * composite OAuth token-storage key SharePoint credentials use to keep two
 * credentials that share the same Azure AD tenant/discovery-endpoint
 * isolated from each other — `"{configUuid}:{oauthEndpoint}"` when a
 * per-credential uuid is known, else falling back to the bare endpoint (or
 * site URL for the config's own connection-test key).
 */
export interface SharepointConnectionTokenKeyInput {
  readonly oauthEndpoint?: string | undefined;
  readonly configUuid?: string | undefined;
  readonly siteUrl?: string | undefined;
}

export function getSharepointConnectionTokenKey({
  oauthEndpoint,
  configUuid,
  siteUrl,
}: SharepointConnectionTokenKeyInput): string | undefined {
  if (oauthEndpoint) {
    return configUuid ? `${configUuid}:${oauthEndpoint}` : oauthEndpoint;
  }
  return configUuid && siteUrl ? `${configUuid}:${siteUrl}` : siteUrl;
}
