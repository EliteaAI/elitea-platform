import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getReplaceParticipantSettingsMockHandler } from '@/shared/api/generated/settings/settings.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '../../../../test/setup';

import type { PipelineChatSwitchVersionInput } from './usePipelineChatSwitchVersion';
import { useAutoSwitchPipelineChatVersion, usePipelineChatSwitchVersion } from './usePipelineChatSwitchVersion';

const BASE = '/api/v2';

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

function baseInput(overrides: Partial<PipelineChatSwitchVersionInput> = {}): PipelineChatSwitchVersionInput {
  return {
    projectId: 'p1',
    conversationId: 5,
    participantId: 9,
    activeEntitySettings: { foo: 'bar' },
    versionId: 42,
    variables: [{ name: 'x', value: '1' }],
    llmSettings: { model_name: 'gpt' },
    iconMeta: { url: 'icon.png' },
    ...overrides,
  };
}

describe('usePipelineChatSwitchVersion', () => {
  it('PUTs the full merged entity_settings and returns it on success', async () => {
    server.use(getReplaceParticipantSettingsMockHandler({ entity_settings: {} }));
    const { result } = renderHook(() => usePipelineChatSwitchVersion(), { wrapper: createWrapper() });

    let returned;
    await act(async () => {
      returned = await result.current.updateParticipantWithNewVersionId(baseInput());
    });

    expect(returned).toEqual({
      foo: 'bar',
      version_id: 42,
      variables: [{ name: 'x', value: '1' }],
      llm_settings: { model_name: 'gpt' },
      icon_meta: { url: 'icon.png' },
    });
    await waitFor(() => expect(result.current.isUpdating).toBe(false));
  });

  it('defaults variables/llmSettings/iconMeta when undefined', async () => {
    server.use(getReplaceParticipantSettingsMockHandler({ entity_settings: {} }));
    const { result } = renderHook(() => usePipelineChatSwitchVersion(), { wrapper: createWrapper() });

    let returned;
    await act(async () => {
      returned = await result.current.updateParticipantWithNewVersionId(
        baseInput({ activeEntitySettings: undefined, variables: undefined, llmSettings: undefined, iconMeta: undefined }),
      );
    });

    expect(returned).toEqual({ version_id: 42, variables: [], llm_settings: {}, icon_meta: {} });
  });

  it('sets error/errorMessage and returns undefined on failure', async () => {
    server.use(
      http.put('*/elitea_core/entity_settings/prompt_lib/:projectId/:conversationId/:participantId', () =>
        HttpResponse.json({ error: 'invalid settings' }, { status: 400 }),
      ),
    );
    const { result } = renderHook(() => usePipelineChatSwitchVersion(), { wrapper: createWrapper() });

    let returned;
    await act(async () => {
      returned = await result.current.updateParticipantWithNewVersionId(baseInput());
    });

    expect(returned).toBeUndefined();
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.errorMessage?.length).toBeGreaterThan(0);
  });
});

describe('useAutoSwitchPipelineChatVersion', () => {
  it('does not fire on first mount (only records the initial versionId)', async () => {
    let calls = 0;
    server.use(
      getReplaceParticipantSettingsMockHandler(() => {
        calls += 1;
        return { entity_settings: {} };
      }),
    );
    const onSwitched = () => {};
    renderHook(
      (props: { versionId: number }) => useAutoSwitchPipelineChatVersion(baseInput({ versionId: props.versionId }), onSwitched),
      { wrapper: createWrapper(), initialProps: { versionId: 42 } },
    );
    await waitFor(() => expect(calls).toBe(0));
  });

  it('fires when versionId changes across a re-render, and calls onSwitched', async () => {
    let calls = 0;
    server.use(
      getReplaceParticipantSettingsMockHandler(() => {
        calls += 1;
        return { entity_settings: {} };
      }),
    );
    let switchedWith: unknown;
    const { rerender } = renderHook(
      (props: { versionId: number }) =>
        useAutoSwitchPipelineChatVersion(baseInput({ versionId: props.versionId }), (settings) => (switchedWith = settings)),
      { wrapper: createWrapper(), initialProps: { versionId: 42 } },
    );

    rerender({ versionId: 43 });

    await waitFor(() => expect(calls).toBe(1));
    await waitFor(() => expect(switchedWith).toBeDefined());
  });

  it('still calls onSwitched with the new version settings AND fires onError when the PUT fails (baseline `useApplicationChatSwitchVersion.js:18-43`\'s always-applied optimistic update)', async () => {
    server.use(
      http.put('*/elitea_core/entity_settings/prompt_lib/:projectId/:conversationId/:participantId', () =>
        HttpResponse.json({ error: 'invalid settings' }, { status: 400 }),
      ),
    );
    let switchedWith: Readonly<Record<string, unknown>> | undefined;
    let calls = 0;
    const onError = () => {
      calls += 1;
    };
    const { rerender } = renderHook(
      (props: { versionId: number }) =>
        useAutoSwitchPipelineChatVersion(
          baseInput({ versionId: props.versionId }),
          (settings) => (switchedWith = settings),
          onError,
        ),
      { wrapper: createWrapper(), initialProps: { versionId: 42 } },
    );

    rerender({ versionId: 43 });

    // The failed PUT must NOT leave entitySettings stuck on the old version's values.
    await waitFor(() => expect(switchedWith).toMatchObject({ version_id: 43 }));
    await waitFor(() => expect(calls).toBe(1));
  });

  it('does not fire (no PUT, no onSwitched, no onError) when versionId transitions to undefined, matching the "undefined means not ready" contract instead of treating it as a real switch', async () => {
    let calls = 0;
    server.use(
      getReplaceParticipantSettingsMockHandler(() => {
        calls += 1;
        return { entity_settings: {} };
      }),
    );
    let switchedWith: unknown;
    let errorCalls = 0;
    const initialProps: { versionId: number | undefined } = { versionId: 42 };
    const { rerender } = renderHook(
      (props: { versionId: number | undefined }) =>
        useAutoSwitchPipelineChatVersion(
          baseInput({ versionId: props.versionId }),
          (settings) => (switchedWith = settings),
          () => {
            errorCalls += 1;
          },
        ),
      { wrapper: createWrapper(), initialProps },
    );

    // Simulates `usePipelineChatConversation.hooks.ts`'s chat-history-reset effect clearing
    // `activeConversation.id`, which drops `pipelineChat.helpers.ts`'s `switchVersionId` back to
    // `undefined` on the same version-id change -- NOT a real "switch to no version".
    rerender({ versionId: undefined });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(0);
    expect(switchedWith).toBeUndefined();
    expect(errorCalls).toBe(0);

    // Once the conversation reset settles and the real version id resolves again, this must be
    // treated like the very first mount -- no switch fired for the version already active.
    rerender({ versionId: 43 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(0);
    expect(switchedWith).toBeUndefined();

    // A genuine subsequent switch still works correctly after all this.
    rerender({ versionId: 44 });
    await waitFor(() => expect(calls).toBe(1));
    await waitFor(() => expect(switchedWith).toMatchObject({ version_id: 44 }));
  });
});
