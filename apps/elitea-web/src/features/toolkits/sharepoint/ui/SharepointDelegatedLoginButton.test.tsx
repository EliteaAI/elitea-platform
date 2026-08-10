import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderWithProviders } from '../../__tests__/testUtils';
import type { SharepointResolvedConfig } from '../lib/hooks/useResolvedSharepointConfig.hooks';
import { setConnectionVerified } from '../lib/helpers/mcpTokenStorage.helpers';
import { SharepointDelegatedLoginButton } from './SharepointDelegatedLoginButton';

const spConfig: SharepointResolvedConfig = {
  oauth_discovery_endpoint: 'https://login.microsoftonline.com/tenant',
  configuration_uuid: 'uuid-1',
};
const oauthTokenKey = 'uuid-1:https://login.microsoftonline.com/tenant';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  window.sessionStorage.clear();
});

afterEach(() => {
  resetGeneratedClient();
  window.sessionStorage.clear();
});

describe('SharepointDelegatedLoginButton', () => {
  it('shows the OfflineIcon and a "Log in" button when not connected', () => {
    renderWithProviders(
      <SharepointDelegatedLoginButton
        projectId="proj-1"
        spConfig={spConfig}
        oauthTokenKey={oauthTokenKey}
      />,
    );
    expect(screen.getByText('Log in')).toBeInTheDocument();
  });

  it('shows only the OnlineIcon (no "Log in" button) when already connected', () => {
    setConnectionVerified(oauthTokenKey);
    renderWithProviders(
      <SharepointDelegatedLoginButton
        projectId="proj-1"
        spConfig={spConfig}
        oauthTokenKey={oauthTokenKey}
      />,
    );
    expect(screen.queryByText('Log in')).not.toBeInTheDocument();
  });

  it('clicking "Log in" runs the connection check and forwards a requires_authorization 401 to onConfigAuthRequired', async () => {
    server.use(
      http.post('*/api/v2/configurations/check_connection/proj-1/sharepoint', () =>
        HttpResponse.json({ requires_authorization: true, auth_metadata: { server_url: 'https://x', resource_metadata: {} } }, { status: 401 }),
      ),
    );
    const onConfigAuthRequired = vi.fn();

    renderWithProviders(
      <SharepointDelegatedLoginButton
        projectId="proj-1"
        spConfig={spConfig}
        oauthTokenKey={oauthTokenKey}
        onConfigAuthRequired={onConfigAuthRequired}
      />,
    );

    fireEvent.click(screen.getByText('Log in'));

    await waitFor(() => expect(screen.getByText('Log in')).not.toBeDisabled());
    // INVERTED (was `not.toHaveBeenCalled()`, citing http.ts's reauth
    // interceptor stripping every 401 body): that interceptor now lets a
    // `requires_authorization` 401 through with its body intact, so the
    // caller's own auth-modal hook finally receives the metadata.
    await waitFor(() => expect(onConfigAuthRequired).toHaveBeenCalledTimes(1));
  });

  it(
    'falls back to "SharePoint" in the tooltip when toolName is an empty string ' +
      "(baseline: `toolName || 'SharePoint'` — falsy, not nullish-only)",
    async () => {
      renderWithProviders(
        <SharepointDelegatedLoginButton
          projectId="proj-1"
          spConfig={spConfig}
          oauthTokenKey={oauthTokenKey}
          toolName=""
        />,
      );

      fireEvent.mouseOver(screen.getByText('Log in'));

      expect(await screen.findByText('SharePoint is not connected. Log in to use.')).toBeInTheDocument();
    },
  );

  /**
   * REPLACES the old "renders the injected auth-modal slot only when both
   * renderAuthModal and authModalSlotProps are supplied" case. That pair was
   * removed: nothing in `src/` ever supplied it (dead wiring that read as an
   * available extension point), and it was redundant — the caller that
   * supplies `onConfigAuthRequired` owns the `useSharepointAuthModal`
   * instance behind it, so it holds `modalProps` and renders the modal
   * itself. This asserts the contract that remains: the button reports
   * status and delegates the 401 outward, and renders no modal of its own.
   */
  it('renders no modal of its own — the 401 handler is delegated to the caller', () => {
    const onConfigAuthRequired = vi.fn();
    const { container } = renderWithProviders(
      <SharepointDelegatedLoginButton
        projectId="proj-1"
        spConfig={spConfig}
        oauthTokenKey={oauthTokenKey}
        onConfigAuthRequired={onConfigAuthRequired}
      />,
    );

    expect(screen.getByText('Log in')).toBeInTheDocument();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
