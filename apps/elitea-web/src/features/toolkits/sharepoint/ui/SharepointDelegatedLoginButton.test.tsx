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

  it(
    'clicking "Log in" runs the connection check; onConfigAuthRequired is NOT called for a real 401 today ' +
      '(REAL, CURRENT GAP — see useSharepointCheckConnection.hooks.ts\'s module doc comment: http.ts\'s reauth ' +
      'interceptor strips the response body from every 401 before this callback chain ever sees it)',
    async () => {
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
      expect(onConfigAuthRequired).not.toHaveBeenCalled();
    },
  );

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

  it('renders the injected auth-modal slot only when both renderAuthModal and authModalSlotProps are supplied', () => {
    const renderAuthModal = vi.fn(() => <div data-testid="injected-modal" />);
    renderWithProviders(
      <SharepointDelegatedLoginButton
        projectId="proj-1"
        spConfig={spConfig}
        oauthTokenKey={oauthTokenKey}
        renderAuthModal={renderAuthModal}
      />,
    );
    expect(screen.queryByTestId('injected-modal')).not.toBeInTheDocument();
    expect(renderAuthModal).not.toHaveBeenCalled();
  });
});
