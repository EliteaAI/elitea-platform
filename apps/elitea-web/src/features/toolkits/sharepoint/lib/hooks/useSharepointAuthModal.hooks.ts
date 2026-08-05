import { useCallback, useState } from 'react';

/**
 * Local, `features/toolkits`-owned duplicate of the STATE-MACHINERY half of
 * `apps/elitea-ui/src/[fsd]/features/mcp/lib/hooks/useMcpAuthModal.hooks.js`'s
 * `useConfigOAuthModal` — see `../helpers/mcpTokenStorage.helpers.ts`'s doc
 * comment for the full "thin piece, not a redesign" rationale
 * (`no-sideways-features` forbids importing the real hook from
 * `features/mcps`, and `features/mcps/index.ts`'s own doc comment records
 * that even IT keeps `useConfigOAuthModal` intra-slice-only, never promoted
 * to its public API — so there is no legal import path to it either way).
 *
 * DISCLOSED REDESIGN beyond "duplicate the thin pieces": the baseline's
 * `useConfigOAuthModal.getModalProps()` returns props destined directly for
 * `<McpAuthModal>` — a real component that runs the OAuth PKCE/discovery/
 * popup-window flow (`features/mcps/ui/McpAuthModal.tsx`, ~200+ lines with
 * `lib/{crypto,discoveryMetadata,oauthFlow,window,registerDynamicClient}.ts`
 * behind it). That flow is NOT "thin" and stays `features/mcps`-owned, so it
 * is not duplicated here. Instead, this hook exposes its STATE (open/closed,
 * the extracted auth metadata, the resolved server url + token storage key)
 * as `SharepointAuthModalSlotProps` — a locally-typed, `McpAuthModal`-prop-
 * COMPATIBLE shape (same field names/semantics as `McpAuthModalProps`, kept
 * in sync by inspection, not by import) that a `widgets/`/`pages/`-layer
 * caller (which sits ABOVE both `features/toolkits` and `features/mcps` and
 * may legally import both) spreads onto a REAL `<McpAuthModal>` it renders
 * itself. This is the same "peers inject a slot, a higher layer wires the
 * concrete implementation" shape `entities/application-form`'s
 * `ApplicationConfigurationLayout` already established for its own six
 * cross-feature panel slots.
 */
export interface SharepointConfigAuthMetadata {
  readonly authServers?: readonly string[];
  readonly oauthAuthorizationServer?: {
    readonly token_endpoint?: string;
    readonly authorization_endpoint?: string;
    readonly revocation_endpoint?: string;
    readonly registration_endpoint?: string;
    readonly issuer?: string;
    readonly grant_types_supported?: readonly string[];
    readonly code_challenge_methods_supported?: readonly string[];
  } | null;
  readonly providedSettings?: Readonly<Record<string, unknown>>;
  readonly resourceScopes?: readonly string[];
}

/**
 * `useMcpAuthModal.hooks.js`'s `extractConfigAuthMetadata` — a pure mapping
 * from a `check_connection` 401 body's `auth_metadata` field to the shape
 * `McpAuthModal`/this hook's slot props expect. Ported verbatim (no network,
 * no storage — genuinely thin).
 */
export function extractSharepointConfigAuthMetadata(authMetadata: unknown): SharepointConfigAuthMetadata | null {
  if (typeof authMetadata !== 'object' || authMetadata === null) return null;
  const resourceMetadata = (authMetadata as { readonly resource_metadata?: Record<string, unknown> }).resource_metadata ?? {};
  const oauthServer = resourceMetadata.oauth_authorization_server as SharepointConfigAuthMetadata['oauthAuthorizationServer'] | undefined;
  const resourceScopes = resourceMetadata.scopes_supported as readonly string[] | undefined;
  return {
    authServers:
      (resourceMetadata.authorization_servers as readonly string[] | undefined) ??
      ((authMetadata as { readonly authorization_servers?: readonly string[] }).authorization_servers ?? []),
    oauthAuthorizationServer: oauthServer ?? null,
    providedSettings: (resourceMetadata.provided_settings as Readonly<Record<string, unknown>> | undefined) ?? {},
    // `exactOptionalPropertyTypes`: `resourceScopes` is declared `?: readonly
    // string[]` (key may be ABSENT, never explicitly `undefined`) — the
    // conditional spread omits the key entirely when there is nothing to
    // report, matching this codebase's established convention (e.g.
    // `shared/api/generated/mutator.ts`'s own `signal`/`headers`/`body`
    // spreads).
    ...(resourceScopes !== undefined && { resourceScopes }),
  };
}

export interface SharepointAuthModalSlotProps {
  readonly open: boolean;
  readonly serverUrl: string;
  readonly tokenStorageKey: string | undefined;
  readonly mcpAuthMetadata: SharepointConfigAuthMetadata | null;
  readonly formClientId: string;
  readonly formClientSecret: string;
  readonly formScopes?: string | readonly string[];
  readonly projectId: string | undefined;
  readonly toolkitId: string | undefined;
  readonly title: string;
  readonly onClose: (success: boolean) => void;
  readonly onCancel: () => void;
}

export interface UseSharepointAuthModalInput {
  readonly projectId: string | undefined;
  readonly toolkitId: string | undefined;
  readonly credentials?: {
    readonly client_id?: string;
    readonly client_secret?: string;
    readonly scopes?: string | readonly string[];
  };
  /** Called after a successful OAuth completion (`onClose(true)`), e.g. to re-run the connection test. */
  readonly onSuccess?: () => void;
}

export interface UseSharepointAuthModalResult {
  readonly showModal: boolean;
  /** Baseline `handleConfigAuthRequired(errorData, serverUrlOverride, tokenStorageKeyOverride)` — call from a `check_connection` 401 catch handler. */
  readonly handleConfigAuthRequired: (errorData: unknown, serverUrlOverride?: string, tokenStorageKeyOverride?: string) => void;
  readonly modalProps: SharepointAuthModalSlotProps;
}

export function useSharepointAuthModal(input: UseSharepointAuthModalInput): UseSharepointAuthModalResult {
  const { projectId, toolkitId, credentials, onSuccess } = input;

  const [showModal, setShowModal] = useState(false);
  const [mcpAuthMetadata, setMcpAuthMetadata] = useState<SharepointConfigAuthMetadata | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [tokenStorageKey, setTokenStorageKey] = useState('');

  const handleConfigAuthRequired = useCallback(
    (errorData: unknown, serverUrlOverride?: string, tokenStorageKeyOverride?: string) => {
      const authMetadata = (errorData as { readonly auth_metadata?: unknown } | undefined)?.auth_metadata;
      if (authMetadata === undefined) return;
      const metadata = extractSharepointConfigAuthMetadata(authMetadata);
      if (metadata === null) return;
      const resolvedServerUrl = serverUrlOverride ?? (authMetadata as { readonly server_url?: string }).server_url ?? '';
      setMcpAuthMetadata(metadata);
      setServerUrl(resolvedServerUrl);
      setTokenStorageKey(tokenStorageKeyOverride ?? resolvedServerUrl);
      setShowModal(true);
    },
    [],
  );

  const handleClose = useCallback(
    (success: boolean) => {
      setShowModal(false);
      setMcpAuthMetadata(null);
      setServerUrl('');
      setTokenStorageKey('');
      if (success) onSuccess?.();
    },
    [onSuccess],
  );

  const handleCancel = useCallback(() => {
    setShowModal(false);
    setMcpAuthMetadata(null);
    setServerUrl('');
    setTokenStorageKey('');
  }, []);

  // Plain object, not `useMemo` — this is a cheap literal (no expensive
  // computation to cache) with nine independent inputs, one over the §3.5
  // `hook-deps` budget (8) were it memoized; skipping memoization here
  // avoids the budget breach without inventing an artificial grouping just
  // to shrink the dependency array.
  const modalProps: SharepointAuthModalSlotProps = {
    open: showModal && mcpAuthMetadata !== null,
    serverUrl,
    tokenStorageKey: tokenStorageKey === '' ? undefined : tokenStorageKey,
    mcpAuthMetadata,
    formClientId: credentials?.client_id ?? '',
    formClientSecret: credentials?.client_secret ?? '',
    ...(credentials?.scopes !== undefined && { formScopes: credentials.scopes }),
    projectId,
    toolkitId,
    title: 'Configuration OAuth',
    onClose: handleClose,
    onCancel: handleCancel,
  };

  return { showModal, handleConfigAuthRequired, modalProps };
}
