/**
 * What a green `PipelineTestChat.test.tsx` still could not see: what happens
 * to a test conversation AFTER it exists.
 *
 * Both behaviours pinned here are invisible from the rendered pane. The
 * version a pipeline chat runs is state on the SERVER's participant row, so
 * "the editor switched versions" and "the chat switched versions" are two
 * different events, and the failure mode between them is a chat that answers
 * correctly from the wrong graph. And the repair for that — writing the new
 * version onto the row — has its own trap: doing the obvious thing to the
 * CLIENT copy at the same time silently empties the transcript.
 */
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';
import { server } from '@/test/setup';

import {
  resetPipelineTestConversationsForTests,
  usePipelineTestConversation,
  type PipelineTestChatIdentity,
} from './usePipelineTestConversation';

const BASE = '/api/v2';
const globals = globalThis as unknown as Record<string, unknown>;

const IDENTITY: PipelineTestChatIdentity = {
  projectId: '9',
  applicationId: '42',
  pipelineName: 'My Pipeline',
  versionId: '7',
  agentType: 'pipeline',
  userId: '6',
};

interface SettingsPut {
  readonly participantId: string;
  readonly body: Readonly<Record<string, unknown>>;
}

interface Routes {
  readonly puts: SettingsPut[];
  readonly creates: () => number;
  /** Make the settings PUT fail, the way a permission error would. */
  failSettings: boolean;
}

function installRoutes(): Routes {
  const puts: SettingsPut[] = [];
  const counter = { creates: 0 };
  const state = { failSettings: false };
  server.use(
    http.post(`${BASE}/elitea_core/conversations/prompt_lib/:projectId`, () => {
      counter.creates += 1;
      return HttpResponse.json({ id: 501, uuid: '00000000-0000-4000-8000-000000000abc', name: 'My Pipeline' });
    }),
    http.post(`${BASE}/elitea_core/participants/prompt_lib/:projectId/:conversationId`, () => HttpResponse.json([])),
    http.get(`${BASE}/elitea_core/conversation/prompt_lib/:projectId/:conversationId`, () =>
      HttpResponse.json({
        id: 501,
        uuid: '00000000-0000-4000-8000-000000000abc',
        name: 'My Pipeline',
        participants: [
          { id: '900', entity_name: 'user', entity_meta: { id: 6 } },
          {
            id: '901',
            entity_name: 'application',
            entity_meta: { id: '42' },
            entity_settings: { version_id: '7', agent_type: 'pipeline', variables: [], icon_meta: {}, llm_settings: { temperature: 0.4 } },
          },
        ],
      }),
    ),
    http.put(`${BASE}/elitea_core/entity_settings/prompt_lib/:projectId/:conversationId/:participantId`, async ({ request, params }) => {
      if (state.failSettings) return new HttpResponse(null, { status: 403 });
      const body = (await request.json()) as Readonly<Record<string, unknown>>;
      puts.push({ participantId: String(params['participantId']), body });
      return HttpResponse.json({ entity_settings: body });
    }),
  );
  return {
    puts,
    creates: () => counter.creates,
    get failSettings() {
      return state.failSettings;
    },
    set failSettings(value: boolean) {
      state.failSettings = value;
    },
  };
}

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  globals['elitea_ui_config'] = { vite_server_url: BASE, vite_base_uri: '/', vite_public_project_id: 'public-1' };
  resetConfigForTests();
  configureGeneratedClient({ baseUrl: BASE });
  // Module scope, so it outlives a `render`. Without this each test would
  // inherit the previous one's conversation.
  resetPipelineTestConversationsForTests();
});

afterEach(() => {
  delete globals['elitea_ui_config'];
  resetConfigForTests();
  resetGeneratedClient();
});

describe('usePipelineTestConversation', () => {
  it('writes the new version onto the persisted participant when the editor switches versions', async () => {
    const routes = installRoutes();
    const { result, rerender } = renderHook((identity: PipelineTestChatIdentity) => usePipelineTestConversation(identity), {
      wrapper: createWrapper(),
      initialProps: IDENTITY,
    });

    result.current.ensure();
    await waitFor(() => expect(result.current.conversation).toBeDefined());
    expect(routes.puts).toHaveLength(0);

    rerender({ ...IDENTITY, versionId: '9' });

    // The worker resolves the graph from the STORED row, so this PUT is the
    // whole switch. Without it the pane shows v9 and answers from v7.
    await waitFor(() => expect(routes.puts).toHaveLength(1));
    const put = routes.puts[0];
    expect(put?.participantId).toBe('901');
    expect(put?.body['version_id']).toBe('9');
    // The PUT REPLACES `entity_settings` (`SET entity_settings = $1`), so a
    // bare `{version_id}` patch would drop the discriminator that routes the
    // turn to the graph assembler — and the settings already on the row.
    expect(put?.body['agent_type']).toBe('pipeline');
    expect(put?.body['llm_settings']).toEqual({ temperature: 0.4 });
  });

  it('leaves the client participant list untouched, because ChatBox re-seeds its transcript from it', async () => {
    installRoutes();
    const { result, rerender } = renderHook((identity: PipelineTestChatIdentity) => usePipelineTestConversation(identity), {
      wrapper: createWrapper(),
      initialProps: IDENTITY,
    });

    result.current.ensure();
    await waitFor(() => expect(result.current.conversation).toBeDefined());
    const participantsBefore = result.current.conversation?.participants;

    rerender({ ...IDENTITY, versionId: '9' });
    await waitFor(() => expect(result.current.staleVersionId).toBeUndefined());

    // Reference equality, not deep equality: `useChatBoxData`'s
    // `seedConversationForSync` has `participants` in its dependency list and
    // resets `conversationForSync` — the LIVE transcript — whenever that array
    // changes identity. This hook passes `message_groups: []`, so writing the
    // new version into the client row would blank the chat mid-conversation.
    expect(result.current.conversation?.participants).toBe(participantsBefore);
  });

  it('says which version replies still run when the switch cannot be written', async () => {
    const routes = installRoutes();
    const { result, rerender } = renderHook((identity: PipelineTestChatIdentity) => usePipelineTestConversation(identity), {
      wrapper: createWrapper(),
      initialProps: IDENTITY,
    });

    result.current.ensure();
    await waitFor(() => expect(result.current.conversation).toBeDefined());

    routes.failSettings = true;
    rerender({ ...IDENTITY, versionId: '9' });

    // Named, not a bare boolean: the useful thing to tell the user is which
    // graph is actually answering, which is the OLD version.
    await waitFor(() => expect(result.current.staleVersionId).toBe('7'));
  });

  it('re-attaches to the conversation it already made instead of minting one per pane mount', async () => {
    const routes = installRoutes();
    const wrapper = createWrapper();
    const first = renderHook(() => usePipelineTestConversation(IDENTITY), { wrapper });
    first.result.current.ensure();
    await waitFor(() => expect(first.result.current.conversation).toBeDefined());
    expect(routes.creates()).toBe(1);
    first.unmount();

    // The pane unmounts on every editor tab switch. A per-mount guard alone
    // would leave one private conversation per switch in the user's sidebar.
    const second = renderHook(() => usePipelineTestConversation(IDENTITY), { wrapper });
    second.result.current.ensure();
    await waitFor(() => expect(second.result.current.conversation).toBeDefined());
    expect(routes.creates()).toBe(1);
    expect(second.result.current.activeParticipant).toBeDefined();
  });
});
