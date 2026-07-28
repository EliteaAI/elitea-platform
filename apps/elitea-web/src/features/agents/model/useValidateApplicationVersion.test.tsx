import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getGetApplicationVersionDetailMockHandler,
  getValidateApplicationVersionMockHandler,
} from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import type { AgentToolAssociation } from '../lib/types';

import { useApplicationsStore } from './applicationsStore';
import {
  useManualValidateApplicationVersion,
  useToolValidationInfo,
  useToolsValidationInfo,
  useValidateApplicationVersion,
} from './useValidateApplicationVersion';
import { renderHookWithProviders } from '../__tests__/testUtils';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  useApplicationsStore.setState({ versionValidationInfo: {} });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useValidateApplicationVersion', () => {
  it('disables the underlying query while any arg is undefined and reports no error', async () => {
    const { result } = renderHookWithProviders(() =>
      useValidateApplicationVersion({ projectId: undefined, applicationId: undefined, versionId: undefined }),
    );
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current.isError).toBe(false);
  });

  it('reports isError=false when the real endpoint responds {valid: true}', async () => {
    server.use(getValidateApplicationVersionMockHandler({ valid: true }));
    const { result } = renderHookWithProviders(() =>
      useValidateApplicationVersion({ projectId: 'p1', applicationId: 3, versionId: 7 }),
    );
    await waitFor(() => expect(result.current.isError).toBe(false));
  });

  it('reports isError=false even when {valid: false} — the endpoint always 200s (see module doc: existence check only)', async () => {
    server.use(getValidateApplicationVersionMockHandler({ valid: false }));
    const { result } = renderHookWithProviders(() =>
      useValidateApplicationVersion({ projectId: 'p1', applicationId: 3, versionId: 7 }),
    );
    await waitFor(() => expect(result.current).toBeDefined());
    expect(result.current.isError).toBe(false);
  });

  it('calls onError on a genuine network/auth failure', async () => {
    server.use(
      http.get('*/elitea_core/version_validator/prompt_lib/:projectId/:applicationId/:versionId', () =>
        HttpResponse.json({ error: 'forbidden' }, { status: 403 }),
      ),
    );
    const onError = vi.fn();
    const { result } = renderHookWithProviders(() =>
      useValidateApplicationVersion({ projectId: 'p1', applicationId: 3, versionId: 7 }, { onError }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  });
});

describe('useManualValidateApplicationVersion', () => {
  const tools: AgentToolAssociation[] = [{ id: 'tool-1', type: 'toolkit' }];

  it('resolves {kind: "skipped"} when required ids are missing', async () => {
    const { result } = renderHookWithProviders(() =>
      useManualValidateApplicationVersion(
        { applicationId: undefined, projectId: 'p1', versionId: 7, tools, toolId: 'tool-1' },
        false,
      ),
    );
    let outcome;
    await act(async () => {
      outcome = await result.current.doValidateVersion();
    });
    expect(outcome).toEqual({ kind: 'skipped' });
  });

  it('resolves {kind: "skipped"} when needValidateTheWholeAgent is false, after validating', async () => {
    server.use(getValidateApplicationVersionMockHandler({ valid: true }));
    const { result } = renderHookWithProviders(() =>
      useManualValidateApplicationVersion(
        { applicationId: 3, projectId: 'p1', versionId: 7, tools, toolId: 'tool-1', needValidateTheWholeAgent: false },
        false,
      ),
    );
    let outcome;
    await act(async () => {
      outcome = await result.current.doValidateVersion();
    });
    expect(outcome).toEqual({ kind: 'skipped' });
  });

  it('resolves {kind: "toolsReplacement"} with the refetched tools when the form is clean (not dirty)', async () => {
    server.use(
      getValidateApplicationVersionMockHandler({ valid: true }),
      getGetApplicationVersionDetailMockHandler({
        id: '7',
        application_id: '3',
        name: 'base',
        status: 'draft',
        tools: [{ id: 1, type: 'toolkit' }],
      }),
    );
    const { result } = renderHookWithProviders(() =>
      useManualValidateApplicationVersion({ applicationId: 3, projectId: 'p1', versionId: 7, tools, toolId: 1 }, false),
    );
    let outcome;
    await act(async () => {
      outcome = await result.current.doValidateVersion();
    });
    expect(outcome).toEqual({ kind: 'toolsReplacement', tools: [{ id: 1, type: 'toolkit' }] });
  });

  it('resolves {kind: "availableToolsPatch"} for the edited tool when the form is dirty', async () => {
    server.use(
      getValidateApplicationVersionMockHandler({ valid: true }),
      getGetApplicationVersionDetailMockHandler({
        id: '7',
        application_id: '3',
        name: 'base',
        status: 'draft',
        tools: [{ id: 2, type: 'toolkit', settings: { available_tools: ['a', 'b'] } }],
      }),
    );
    const { result } = renderHookWithProviders(() =>
      useManualValidateApplicationVersion({ applicationId: 3, projectId: 'p1', versionId: 7, tools, toolId: 1 }, true),
    );
    let outcome;
    await act(async () => {
      outcome = await result.current.doValidateVersion();
    });
    expect(outcome).toEqual({ kind: 'availableToolsPatch', toolId: 1, availableTools: ['a', 'b'] });
  });

  it('also validates a sub-application (type: application) tool matching toolId', async () => {
    const subApplicationTools: AgentToolAssociation[] = [
      { id: 'sub-1', type: 'application', settings: { application_id: '9', application_version_id: '11' } },
    ];
    let calls = 0;
    server.use(
      getValidateApplicationVersionMockHandler(() => {
        calls += 1;
        return { valid: true };
      }),
      getGetApplicationVersionDetailMockHandler({
        id: '7',
        application_id: '3',
        name: 'base',
        status: 'draft',
        tools: [],
      }),
    );
    const { result } = renderHookWithProviders(() =>
      useManualValidateApplicationVersion(
        { applicationId: 3, projectId: 'p1', versionId: 7, tools: subApplicationTools, toolId: 'sub-1' },
        false,
      ),
    );
    await act(async () => {
      await result.current.doValidateVersion();
    });
    // one call for the parent version, one for the sub-application's own version
    expect(calls).toBe(2);
  });
});

describe('useToolsValidationInfo / useToolValidationInfo', () => {
  const tools: AgentToolAssociation[] = [{ id: 'tool-1', type: 'toolkit' }];

  it('return empty when there is no stored validation info (the real backend never populates it)', () => {
    const { result } = renderHook(() => useToolsValidationInfo({ applicationId: 3, projectId: 'p1', versionId: 7, tools }));
    expect(result.current.toolsValidationInfo).toEqual({});
    expect(result.current.totalValidationInfo).toEqual([]);
  });

  it('surfaces a stored entry keyed by loc[1] matching a tool id', () => {
    useApplicationsStore.getState().setVersionValidationInfo('p1_3_7', [{ loc: ['tools', 'tool-1'], msg: 'bad config' }]);
    const { result } = renderHook(() => useToolsValidationInfo({ applicationId: 3, projectId: 'p1', versionId: 7, tools }));
    expect(result.current.toolsValidationInfo).toEqual({ 'tool-1': 'bad config' });
    expect(result.current.totalValidationInfo).toEqual(['bad config']);
  });

  it('useToolValidationInfo returns "" when nothing matches', () => {
    const { result } = renderHook(() => useToolValidationInfo({ applicationId: 3, projectId: 'p1', versionId: 7, toolId: 'tool-1' }));
    expect(result.current).toBe('');
  });

  it('useToolValidationInfo returns the matching message', () => {
    useApplicationsStore.getState().setVersionValidationInfo('p1_3_7', [{ loc: ['tools', 'tool-1'], msg: 'bad config' }]);
    const { result } = renderHook(() => useToolValidationInfo({ applicationId: 3, projectId: 'p1', versionId: 7, toolId: 'tool-1' }));
    expect(result.current).toBe('bad config');
  });
});
