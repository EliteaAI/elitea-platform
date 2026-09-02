/**
 * The drawer, driven through the real network boundary.
 *
 * The slice below it is fully tested in isolation. What only exists HERE is the
 * composition: does a question typed into the box reach the provider, does a
 * polled event become a card, and does the answer render as markdown. Every
 * one of those crosses a boundary that a unit test on either side cannot see —
 * the class of defect this repository keeps meeting, where both halves are
 * correct and the wiring is the bug (#597).
 */
import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { WikiChatDrawer } from './WikiChatDrawer';
import type { WikiChatTarget } from '../api/wikiChatApi';

const BASE = 'http://elitea.test/api/v2';

const TARGET: WikiChatTarget = {
  projectId: 7,
  toolkitId: 42,
  toolkitName: 'wiki',
  toolkitType: 'deepwiki',
  settings: { toolkit_configuration_llm_model: 'gpt-5' },
};

let idCounter = 0;
const newId = () => `id-${String((idCounter += 1))}`;

/** Bodies the invocation endpoint returns, in order, one per poll. */
function servePolls(polls: readonly unknown[]) {
  const queue = [...polls];
  server.use(
    http.post(`${BASE}/deepwiki/tools/:projectId/:toolkit/:tool/invoke`, () =>
      HttpResponse.json({ invocation_id: 'inv-1' }),
    ),
    http.get(`${BASE}/deepwiki/invocations/:projectId/:toolkit/:tool/:invocation`, () =>
      HttpResponse.json(queue.shift() ?? { status: 'InProgress' }),
    ),
  );
}

beforeEach(() => {
  idCounter = 0;
  window.localStorage.clear();
  configureGeneratedClient({ baseUrl: BASE });
});
afterEach(() => {
  resetGeneratedClient();
});

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function open() {
  return render(
    <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
      <WikiChatDrawer open onClose={vi.fn()} target={TARGET} newId={newId} />
    </ThemeProvider>,
  );
}

describe('the drawer', () => {
  it('invites a question when there is no conversation yet', () => {
    open();
    expect(screen.getByTestId('wiki-chat-drawer')).toBeInTheDocument();
    expect(screen.getByText(/Ask a question about this repository/)).toBeVisible();
    // Not an empty message list pretending to be a conversation.
    expect(screen.queryByTestId('wiki-chat-messages')).toBeNull();
  });

  it('carries a question to the provider and renders the answer as markdown', async () => {
    const user = userEvent.setup();
    // ONE poll carrying both, which is what the provider returns when a run
    // finishes between two polls. Two polls would need the 2s interval to
    // elapse, and a test that waits on a real timer is a test that flakes.
    servePolls([
      {
        status: 'Completed',
        result: 'The router is in **api/router.go**.',
        custom_events: [
          {
            data: {
              message: JSON.stringify({
                event: 'tool_start',
                data: { id: 't-1', tool: 'search', description: 'Searching the index' },
              }),
            },
          },
        ],
      },
    ]);

    open();
    await user.type(screen.getByLabelText('Question'), 'Where is the router?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // The question appears immediately, before anything has come back.
    expect(await screen.findByText('Where is the router?')).toBeVisible();

    // The tool card came off a poll, through the adapter, through the reducer.
    await waitFor(() => expect(screen.getByTestId('wiki-chat-thinking-block')).toBeVisible());

    const answer = await screen.findByTestId('wiki-chat-answer');
    // MARKDOWN, not the literal asterisks: the answer goes through
    // shared/ui/Markdown and `**api/router.go**` is emphasis, not text.
    expect(answer).toHaveTextContent('The router is in api/router.go.');
    expect(answer.querySelector('strong')).not.toBeNull();
  });

  it('shows the thinking log only when it is asked for', async () => {
    const user = userEvent.setup();
    servePolls([
      {
        status: 'Completed',
        result: 'done',
        custom_events: [
          {
            data: {
              message: JSON.stringify({ event: 'thinking', data: { id: 's', message: 'Reading files' } }),
            },
          },
        ],
      },
    ]);

    open();
    await user.type(screen.getByLabelText('Question'), 'q');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    const block = await screen.findByTestId('wiki-chat-thinking-block');
    // Collapsed by default: the log is context, the answer is the content.
    expect(screen.queryByText('Reading files')).toBeNull();

    await user.click(block.querySelector('button')!);
    expect(await screen.findByText('Reading files')).toBeVisible();
  });

  it('reports a failed invocation instead of spinning', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${BASE}/deepwiki/tools/:projectId/:toolkit/:tool/invoke`, () =>
        HttpResponse.json({ error: 'no slots' }, { status: 503 }),
      ),
    );

    open();
    await user.type(screen.getByLabelText('Question'), 'q');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByTestId('wiki-chat-error')).toBeVisible();
    // And the thinking block is GONE, not left running under a question that
    // never reached the provider.
    expect(screen.queryByTestId('wiki-chat-thinking-block')).toBeNull();

    // And the drawer accepts another question: a failure that left `isLoading`
    // set would refuse every later one with no visible reason.
    await user.type(screen.getByLabelText('Question'), 'try again');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('renders a research plan only when there is one', async () => {
    const user = userEvent.setup();
    servePolls([
      {
        status: 'Completed',
        result: 'answered',
        custom_events: [
          {
            data: {
              message: JSON.stringify({
                event: 'todo_update',
                data: { items: [{ id: 1, title: 'Read the README', status: 'pending' }] },
              }),
            },
          },
        ],
      },
    ]);

    open();
    // An `ask` run has no plan, and an empty panel would claim it has one.
    expect(screen.queryByTestId('wiki-chat-todos')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Research' }));
    await user.type(screen.getByLabelText('Question'), 'how does auth work?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByTestId('wiki-chat-todos')).toBeVisible();
    expect(screen.getByText('Read the README')).toBeVisible();
  });

  it('asks AND POLLS the research tool when the mode says research', async () => {
    // Both halves, because they are two different paths. The poll URL carries
    // the tool segment as well, and polling `ask` for a `deep_research`
    // invocation returns a 404 that reads as a lost invocation: the spinner
    // never stops and nothing is logged.
    const user = userEvent.setup();
    let toolAsked: string | null = null;
    let toolPolled: string | null = null;
    server.use(
      http.post(`${BASE}/deepwiki/tools/:projectId/:toolkit/:tool/invoke`, ({ params }) => {
        toolAsked = String(params['tool']);
        return HttpResponse.json({ invocation_id: 'inv-1' });
      }),
      http.get(`${BASE}/deepwiki/invocations/:projectId/:toolkit/:tool/:invocation`, ({ params }) => {
        toolPolled = String(params['tool']);
        return HttpResponse.json({ status: 'InProgress' });
      }),
    );

    open();
    await user.click(screen.getByRole('button', { name: 'Research' }));
    await user.type(screen.getByLabelText('Question'), 'q');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(toolAsked).toBe('deep_research'));
    await waitFor(() => expect(toolPolled).toBe('deep_research'));
  });

  it('reopens in the capability the last ANSWER used, not the toggle', async () => {
    // The toggle records an intention; the answer records what happened.
    window.localStorage.setItem(
      'el.deepwiki.chat.7.42',
      JSON.stringify([
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a', capability: 'research' },
      ]),
    );
    window.localStorage.setItem('el.deepwiki.chat.capability.7.42', 'ask');

    open();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Research' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
  });

  it('clears the conversation on request', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      'el.deepwiki.chat.7.42',
      JSON.stringify([{ role: 'user', content: 'an old question' }]),
    );

    open();
    expect(screen.getByText('an old question')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Clear the conversation' }));
    expect(screen.queryByText('an old question')).toBeNull();
    await waitFor(() => expect(window.localStorage.getItem('el.deepwiki.chat.7.42')).toBe('[]'));
  });
});
