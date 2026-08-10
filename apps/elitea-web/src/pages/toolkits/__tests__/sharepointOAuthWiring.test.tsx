/**
 * THE DISCRIMINATING TEST for SharePoint's delegated (OAuth) login.
 *
 * Every existing unit test for this feature renders `SharepointOAuthStatus`
 * directly WITH a `renderAuthModal` slot handed to it, so all of them passed
 * while production supplied that slot nowhere — the component was not mounted
 * by any caller at all, three levels of composition root above it
 * (`ToolkitForm` had no `slots` concept, so `ToolBase.slots.
 * sharepointOAuthStatus` was never filled either). This test supplies NO
 * slot, no stub and no fake: it renders the real `EditToolkit` PAGE against
 * mocked HTTP only, and asserts a real `McpAuthModal` opens. It therefore
 * fails if ANY hop in the chain stops forwarding —
 *
 *   EditToolkit -> ConfigurationTab(sharepointAuth) -> ToolkitForm(slots)
 *     -> toolComponentProps -> ToolBase -> ToolBaseStatusSlots
 *     -> SharepointOAuthStatus(renderAuthModal) -> McpAuthModal
 *
 * — and also if the `check_connection` 401's body stops reaching the caller
 * (`shared/api/http.ts`'s resource-authorization branch), which is what
 * carries the `auth_metadata` the modal needs.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { EditToolkit } from '../EditToolkit';
import { renderToolkitsRoute } from './testRouter';

const OAUTH_ENDPOINT = 'https://login.example.com/.well-known/oauth-authorization-server';

const SHAREPOINT_TOOLKIT_ROW = {
  id: 'tk-sp',
  type: 'sharepoint',
  name: 'My SharePoint',
  description: '',
  settings: { sharepoint_configuration: { elitea_title: 'sp-cred', private: false } },
  meta: {},
  created_at: '2026-01-01T00:00:00Z',
  author_id: 1,
};

/** A schema whose `title` is `sharepoint` (the gate `ToolBaseStatusSlots` reads) and which has a `type`, so `getToolComponent` resolves `ToolBase` rather than `ToolCustom`. */
const SHAREPOINT_SCHEMAS = {
  sharepoint: {
    title: 'sharepoint',
    type: 'object',
    properties: {},
    metadata: { label: 'SharePoint' },
  },
};

const SHAREPOINT_CREDENTIAL = {
  uuid: 'cfg-1',
  type: 'sharepoint',
  elitea_title: 'sp-cred',
  data: {
    oauth_discovery_endpoint: OAUTH_ENDPOINT,
    site_url: 'https://contoso.sharepoint.com/sites/demo',
    client_id: 'client-abc',
  },
};

/** The real backend shape for "this toolkit needs its own OAuth": a 401 whose body carries `requires_authorization` plus the authorization-server metadata. */
const AUTH_REQUIRED_BODY = {
  requires_authorization: true,
  auth_metadata: {
    server_url: OAUTH_ENDPOINT,
    resource_metadata: {
      authorization_servers: ['https://login.example.com'],
      oauth_authorization_server: {
        issuer: 'https://login.example.com',
        authorization_endpoint: 'https://login.example.com/authorize',
        token_endpoint: 'https://login.example.com/token',
        code_challenge_methods_supported: ['S256'],
      },
      scopes_supported: ['Sites.Read.All'],
    },
  },
};

function installSharepointToolkitHandlers(onCheckConnection: () => void): void {
  server.use(
    http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () => HttpResponse.json({ rows: [SHAREPOINT_TOOLKIT_ROW], total: 1 })),
    http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json(SHAREPOINT_SCHEMAS)),
    http.get('/api/v2/configurations/configurations/:projectId', () =>
      HttpResponse.json({ items: [SHAREPOINT_CREDENTIAL], total: 1, limit: 20, offset: 0 }),
    ),
    // Unrelated to this feature: `ToolBase`'s credential-field pass reads it
    // on every toolkit form, and it must be an array.
    http.get('/api/v2/configurations/available/', () => HttpResponse.json([])),
    http.post('/api/v2/configurations/check_connection/:projectId/:configType', () => {
      onCheckConnection();
      return HttpResponse.json(AUTH_REQUIRED_BODY, { status: 401 });
    }),
  );
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
  window.sessionStorage.clear();
});

describe('SharePoint delegated OAuth login — production wiring', () => {
  it('mounts the SharePoint status widget from the real page (no slot supplied by this test)', async () => {
    installSharepointToolkitHandlers(() => undefined);

    renderToolkitsRoute(<EditToolkit deps={{ saveToolkit: vi.fn() }} />, '/toolkits/latest/tk-sp', { projectId: 'proj-1' });

    expect(await screen.findByText('Not Connected')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Login' })).toBeInTheDocument();
  });

  it('opens a REAL McpAuthModal when the connection check answers 401 requires_authorization', async () => {
    const onCheckConnection = vi.fn();
    installSharepointToolkitHandlers(onCheckConnection);
    const user = userEvent.setup();

    renderToolkitsRoute(<EditToolkit deps={{ saveToolkit: vi.fn() }} />, '/toolkits/latest/tk-sp', { projectId: 'proj-1' });

    await user.click(await screen.findByRole('button', { name: 'Login' }));

    await waitFor(() => expect(onCheckConnection).toHaveBeenCalled());
    // `Configuration OAuth` is the title `useSharepointAuthModal` puts in its
    // slot props — seeing it proves the props travelled the whole chain and
    // that a real `McpAuthModal` (not a stub) rendered them.
    expect(await screen.findByText('Configuration OAuth')).toBeInTheDocument();
  });
});
