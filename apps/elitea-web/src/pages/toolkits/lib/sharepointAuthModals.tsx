/**
 * The composition root for SharePoint's delegated (OAuth) login modals.
 *
 * `features/toolkits` (where SharePoint's own UI lives) may not import
 * `features/mcps` — `no-sideways-features`, `.dependency-cruiser.cjs`. The
 * `pages/` layer sits above BOTH and may import either, so this is the one
 * place in the app that can put a real `<McpAuthModal>` — the component that
 * actually runs the OAuth PKCE/discovery/popup flow and writes the access
 * token — behind SharePoint's `renderAuthModal` slot.
 *
 * Until this file existed, NOTHING in `src/` filled that slot: the SharePoint
 * status widget was never mounted by any production caller at all, its
 * "Login" button could open nothing, and the only thing that ever made
 * `useSharepointTokenStatus` report "connected" was the non-delegated
 * header-auth sentinel (`setConnectionVerified`).
 *
 * WHY ADAPTERS AND NOT A BARE SPREAD: the two prop shapes are deliberately
 * kept in sync by inspection rather than by import (see
 * `useSharepointAuthModal.hooks.ts`), and they differ in three places that
 * `exactOptionalPropertyTypes` makes load-bearing:
 *  1. `oauthAuthorizationServer` is `... | null` on the SharePoint side,
 *     `... | undefined` on `McpAuthMetadata`.
 *  2. `providedSettings` is an opaque `Record<string, unknown>` on the
 *     SharePoint side (it comes straight off the 401 body) and a typed
 *     `McpProvidedSettings` on the MCP side.
 *  3. `onClose` is `(success: boolean) => void` here and
 *     `(success?: boolean) => void` there.
 * A spread would either not typecheck or would need a cast that hides a real
 * shape difference; these two functions are the whole translation.
 */
import type { ReactNode } from 'react';

import { McpAuthModal, McpLogoutModal } from '@/features/mcps';
import type { McpAuthModalProps } from '@/features/mcps';

type McpAuthMetadataProp = McpAuthModalProps['mcpAuthMetadata'];

/** The `auth_metadata` shape SharePoint's own hook normalises a `check_connection` 401 body into. Structurally declared (not imported): `features/toolkits`' barrel does not export it, and `pages/` may not deep-import a slice. */
interface SharepointAuthMetadataLike {
  readonly authServers?: readonly string[] | undefined;
  readonly oauthAuthorizationServer?: Readonly<Record<string, unknown>> | null | undefined;
  readonly providedSettings?: Readonly<Record<string, unknown>> | undefined;
  readonly resourceScopes?: readonly string[] | undefined;
}

interface SharepointAuthModalSlotPropsLike {
  readonly open: boolean;
  readonly serverUrl: string;
  readonly tokenStorageKey: string | undefined;
  readonly mcpAuthMetadata: SharepointAuthMetadataLike | null;
  readonly formClientId: string;
  readonly formClientSecret: string;
  readonly formScopes?: string | readonly string[] | undefined;
  readonly projectId: string | undefined;
  readonly toolkitId: string | undefined;
  readonly title: string;
  readonly onClose: (success: boolean) => void;
  readonly onCancel: () => void;
}

interface SharepointLogoutModalSlotPropsLike {
  readonly serverUrl: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

function readString(source: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function readScopes(source: Readonly<Record<string, unknown>>): string | readonly string[] | undefined {
  const value = source['scopes'];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return value;
  return undefined;
}

/** Point 1+2 of the module doc comment's shape differences. */
export function toMcpAuthMetadata(metadata: SharepointAuthMetadataLike | null): McpAuthMetadataProp {
  if (metadata === null) return null;
  const provided = metadata.providedSettings ?? {};
  return {
    authServers: metadata.authServers,
    oauthAuthorizationServer: metadata.oauthAuthorizationServer ?? undefined,
    providedSettings: {
      mcp_client_id: readString(provided, 'mcp_client_id'),
      mcp_client_secret: readString(provided, 'mcp_client_secret'),
      scopes: readScopes(provided),
    },
    resourceScopes: metadata.resourceScopes,
  };
}

function renderAuthModal(slotProps: SharepointAuthModalSlotPropsLike): ReactNode {
  return (
    <McpAuthModal
      open={slotProps.open}
      serverUrl={slotProps.serverUrl}
      tokenStorageKey={slotProps.tokenStorageKey}
      mcpAuthMetadata={toMcpAuthMetadata(slotProps.mcpAuthMetadata)}
      formClientId={slotProps.formClientId}
      formClientSecret={slotProps.formClientSecret}
      formScopes={slotProps.formScopes}
      projectId={slotProps.projectId}
      toolkitId={slotProps.toolkitId}
      title={slotProps.title}
      // Point 3: widen `(success: boolean)` to the modal's `(success?: boolean)`.
      onClose={(success) => slotProps.onClose(success ?? false)}
      onCancel={slotProps.onCancel}
    />
  );
}

function renderLogoutModal(slotProps: SharepointLogoutModalSlotPropsLike): ReactNode {
  return (
    <McpLogoutModal
      open={slotProps.open}
      serverUrl={slotProps.serverUrl}
      onClose={slotProps.onClose}
      onConfirm={slotProps.onConfirm}
    />
  );
}

/**
 * Module-level constant, not built per render: `ConfigurationTab` memoizes
 * the `slots` object it derives from this, and a stable identity keeps that
 * memo actually stable.
 */
export const SHAREPOINT_AUTH_MODALS = { renderAuthModal, renderLogoutModal };
