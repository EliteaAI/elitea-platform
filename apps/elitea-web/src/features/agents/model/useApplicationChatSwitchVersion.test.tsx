import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getReplaceParticipantSettingsMockHandler } from '@/shared/api/generated/settings/settings.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderHookWithProviders } from '../__tests__/testUtils';

import type { ApplicationChatSwitchVersionInput } from './useApplicationChatSwitchVersion';
import { useApplicationChatSwitchVersion, useAutoSwitchApplicationChatVersion } from './useApplicationChatSwitchVersion';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

function baseInput(overrides: Partial<ApplicationChatSwitchVersionInput> = {}): ApplicationChatSwitchVersionInput {
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

describe('useApplicationChatSwitchVersion', () => {
  it('PUTs the full merged entity_settings and returns it on success', async () => {
    server.use(getReplaceParticipantSettingsMockHandler({ entity_settings: {} }));
    const { result } = renderHookWithProviders(() => useApplicationChatSwitchVersion());

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
    const { result } = renderHookWithProviders(() => useApplicationChatSwitchVersion());

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
    const { result } = renderHookWithProviders(() => useApplicationChatSwitchVersion());

    let returned;
    await act(async () => {
      returned = await result.current.updateParticipantWithNewVersionId(baseInput());
    });

    expect(returned).toBeUndefined();
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.errorMessage?.length).toBeGreaterThan(0);
  });
});

describe('useAutoSwitchApplicationChatVersion', () => {
  it('does not fire on first mount (only records the initial versionId)', async () => {
    let calls = 0;
    server.use(
      getReplaceParticipantSettingsMockHandler(() => {
        calls += 1;
        return { entity_settings: {} };
      }),
    );
    const onSwitched = () => {};
    renderHookWithProviders((props: { versionId: number }) =>
      useAutoSwitchApplicationChatVersion(baseInput({ versionId: props.versionId }), onSwitched),
      undefined,
      { initialProps: { versionId: 42 } },
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
    const { rerender } = renderHookWithProviders(
      (props: { versionId: number }) =>
        useAutoSwitchApplicationChatVersion(baseInput({ versionId: props.versionId }), (settings) => (switchedWith = settings)),
      undefined,
      { initialProps: { versionId: 42 } },
    );

    rerender({ versionId: 43 });

    await waitFor(() => expect(calls).toBe(1));
    await waitFor(() => expect(switchedWith).toBeDefined());
  });
});
