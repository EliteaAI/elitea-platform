import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { extractSharepointConfigAuthMetadata, useSharepointAuthModal } from './useSharepointAuthModal.hooks';

describe('extractSharepointConfigAuthMetadata', () => {
  it('returns null for a non-object input', () => {
    expect(extractSharepointConfigAuthMetadata(undefined)).toBeNull();
    expect(extractSharepointConfigAuthMetadata(null)).toBeNull();
  });

  it('maps resource_metadata fields into the slot-props metadata shape', () => {
    const result = extractSharepointConfigAuthMetadata({
      resource_metadata: {
        authorization_servers: ['https://login.microsoftonline.com/tenant'],
        oauth_authorization_server: { token_endpoint: 'https://login.microsoftonline.com/tenant/token' },
        provided_settings: { client_id: 'abc' },
        scopes_supported: ['ea9ffc3e-.../.default'],
      },
    });
    expect(result).toEqual({
      authServers: ['https://login.microsoftonline.com/tenant'],
      oauthAuthorizationServer: { token_endpoint: 'https://login.microsoftonline.com/tenant/token' },
      providedSettings: { client_id: 'abc' },
      resourceScopes: ['ea9ffc3e-.../.default'],
    });
  });

  it('falls back to top-level authorization_servers when resource_metadata omits it', () => {
    const result = extractSharepointConfigAuthMetadata({ authorization_servers: ['https://fallback'] });
    expect(result?.authServers).toEqual(['https://fallback']);
  });
});

describe('useSharepointAuthModal', () => {
  it('starts with the modal closed', () => {
    const { result } = renderHook(() => useSharepointAuthModal({ projectId: 'proj-1', toolkitId: 'tk-1' }));
    expect(result.current.showModal).toBe(false);
    expect(result.current.modalProps.open).toBe(false);
  });

  it('handleConfigAuthRequired opens the modal and populates modalProps from the 401 error data', () => {
    const { result } = renderHook(() =>
      useSharepointAuthModal({ projectId: 'proj-1', toolkitId: 'tk-1', credentials: { client_id: 'id-1', client_secret: 'secret-1' } }),
    );

    act(() => {
      result.current.handleConfigAuthRequired(
        {
          auth_metadata: {
            server_url: 'https://login.microsoftonline.com/tenant',
            resource_metadata: { authorization_servers: ['https://login.microsoftonline.com/tenant'] },
          },
        },
        'https://login.microsoftonline.com/tenant',
        'uuid-1:https://login.microsoftonline.com/tenant',
      );
    });

    expect(result.current.showModal).toBe(true);
    expect(result.current.modalProps).toMatchObject({
      open: true,
      serverUrl: 'https://login.microsoftonline.com/tenant',
      tokenStorageKey: 'uuid-1:https://login.microsoftonline.com/tenant',
      formClientId: 'id-1',
      formClientSecret: 'secret-1',
      projectId: 'proj-1',
      toolkitId: 'tk-1',
    });
  });

  it('does nothing when errorData has no auth_metadata', () => {
    const { result } = renderHook(() => useSharepointAuthModal({ projectId: 'proj-1', toolkitId: 'tk-1' }));

    act(() => {
      result.current.handleConfigAuthRequired({});
    });

    expect(result.current.showModal).toBe(false);
  });

  it('onClose(true) resets state and calls onSuccess', () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useSharepointAuthModal({ projectId: 'proj-1', toolkitId: 'tk-1', onSuccess }));

    act(() => {
      result.current.handleConfigAuthRequired({ auth_metadata: { server_url: 'https://x', resource_metadata: {} } });
    });
    expect(result.current.showModal).toBe(true);

    act(() => {
      result.current.modalProps.onClose(true);
    });

    expect(result.current.showModal).toBe(false);
    expect(result.current.modalProps.open).toBe(false);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('onClose(false) resets state without calling onSuccess', () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useSharepointAuthModal({ projectId: 'proj-1', toolkitId: 'tk-1', onSuccess }));

    act(() => {
      result.current.handleConfigAuthRequired({ auth_metadata: { server_url: 'https://x', resource_metadata: {} } });
    });
    act(() => {
      result.current.modalProps.onClose(false);
    });

    expect(result.current.showModal).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('onCancel resets state without calling onSuccess', () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useSharepointAuthModal({ projectId: 'proj-1', toolkitId: 'tk-1', onSuccess }));

    act(() => {
      result.current.handleConfigAuthRequired({ auth_metadata: { server_url: 'https://x', resource_metadata: {} } });
    });
    act(() => {
      result.current.modalProps.onCancel();
    });

    expect(result.current.showModal).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
