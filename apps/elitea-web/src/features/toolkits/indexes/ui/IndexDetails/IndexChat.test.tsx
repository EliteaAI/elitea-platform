import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@/entities/message';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

import { useIndexesStore } from '../../model/indexesStore';

import { IndexChat } from './IndexChat';
import type { ChatMessageListProps, LLMModelSelectorProps } from './IndexChat';

function FakeModelSelector(_props: LLMModelSelectorProps) {
  return <div>model-selector</div>;
}

function FakeClearChatButton(props: { onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClear}
    >
      Clear
    </button>
  );
}

function FakeChatMessageList(props: ChatMessageListProps) {
  return (
    <div>
      <span>count:{props.chat_history.length}</span>
      <span>loading:{String(props.isLoading)}</span>
      {props.chat_history.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => props.onCopyToClipboard(m.id)}
        >
          copy-{m.id}
        </button>
      ))}
    </div>
  );
}

const history: Message[] = [{ id: 'm1', role: 'assistant', content: 'hello world', createdAt: '2024-01-01T00:00:00Z' }];

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderChat(
  overrides: Partial<Parameters<typeof IndexChat>[0]> = {},
  clipboardWriteText: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
) {
  // `clipboardWriteText` is a plain local variable, never read back off
  // `navigator.clipboard.writeText` by assertions — referencing a method
  // through its owning object trips `typescript(unbound-method)` (the
  // reference could lose its `this` binding).
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: clipboardWriteText },
    configurable: true,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          theme={theme}
          defaultMode={DEFAULT_COLOR_SCHEME}
        >
          <IndexChat
            selectedModel={null}
            onSelectModel={vi.fn()}
            modelList={[]}
            llmSettings={{}}
            onSetLLMSettings={vi.fn()}
            isFullScreenChat={false}
            toggleFullScreenChat={vi.fn()}
            clearChat={vi.fn()}
            chatHistory={history}
            conversation={null}
            LLMModelSelector={FakeModelSelector}
            ChatMessageList={FakeChatMessageList}
            ClearChatButton={FakeClearChatButton}
            {...overrides}
          />
        </ThemeProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => 'proj-1' } },
  });
  return { ...render(<RouterProvider router={router} />), clipboardWriteText };
}

beforeEach(() => {
  useIndexesStore.setState({ tempIndexes: [], indexPatches: {}, toolkitScheduler: {}, selectedHistoryItem: null });
});

describe('IndexChat', () => {
  it('renders the model selector and message list when not in history mode', async () => {
    const { findByText } = renderChat();
    expect(await findByText('model-selector')).toBeInTheDocument();
    expect(await findByText('count:1')).toBeInTheDocument();
  });

  it('renders no model selector, and the Clear button is hidden, once in history mode', async () => {
    useIndexesStore.getState().selectHistoryItem({ conversation_id: null, state: 'completed' });
    const { findByText, queryByText } = renderChat();
    await findByText('count:1');
    expect(queryByText('model-selector')).not.toBeInTheDocument();
    expect(queryByText('Clear')).not.toBeInTheDocument();
  });

  it('the fullscreen toggle calls toggleFullScreenChat', async () => {
    const user = userEvent.setup();
    const toggleFullScreenChat = vi.fn();
    const { findByRole } = renderChat({ toggleFullScreenChat });
    await user.click(await findByRole('button', { name: 'Fullscreen mode' }));
    expect(toggleFullScreenChat).toHaveBeenCalledWith(true);
  });

  it('clicking Clear calls clearChat', async () => {
    const user = userEvent.setup();
    const clearChat = vi.fn();
    const { findByText } = renderChat({ clearChat });
    await user.click(await findByText('Clear'));
    expect(clearChat).toHaveBeenCalled();
  });

  it('onCopyToClipboard copies the plain content of the matching message', async () => {
    const user = userEvent.setup();
    const { findByText, clipboardWriteText } = renderChat();
    await user.click(await findByText('copy-m1'));
    expect(clipboardWriteText).toHaveBeenCalledWith('hello world');
  });

  it('onCopyToClipboard reads a messageItems entry content out of item_details.content, matching the baseline (real wire shape never puts content directly on the item)', async () => {
    const user = userEvent.setup();
    const historyWithItems: Message[] = [
      {
        id: 'm2',
        role: 'assistant',
        content: 'top-level content, ignored while messageItems is populated',
        createdAt: '2024-01-01T00:00:00Z',
        messageItems: [{ id: 1, item_details: { content: 'from item_details' } }],
      },
    ];
    const { findByText, clipboardWriteText } = renderChat({ chatHistory: historyWithItems });
    await user.click(await findByText('copy-m2'));
    // Pre-fix, `getMessageItemContent` only ever read a top-level
    // `item.content` (never present on the real wire shape), so every item
    // mapped to '', `.filter(Boolean)` dropped them all, and this would
    // have been called with '' instead of the real text.
    expect(clipboardWriteText).toHaveBeenCalledWith('from item_details');
  });

  it('renders the message-list wrapper as a bordered/rounded card, matching the baseline ChatBodyContainer', async () => {
    const { findByText } = renderChat();
    const countSpan = await findByText('count:1');
    // `countSpan`'s grandparent is the `Box sx={chatBodyContainerSx}` this
    // file renders directly around the injected `ChatMessageList`.
    const chatBodyBox = countSpan.parentElement?.parentElement;
    if (!chatBodyBox) throw new Error('chat body container not found');
    const cls = Array.from(chatBodyBox.classList).find((c) => c.startsWith('css-'));
    if (!cls) throw new Error('emotion class not found on chat body container');

    // jsdom's CSS engine doesn't resolve `var(...)` inside shorthand
    // properties for `getComputedStyle`, so assert on the generated rule's
    // own CSS text instead of the resolved computed style.
    let cssText = '';
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if ('selectorText' in rule && (rule as CSSStyleRule).selectorText?.includes(cls)) {
          cssText += (rule as CSSStyleRule).cssText;
        }
      }
    }
    expect(cssText).toMatch(/border-radius:\s*var\(--el-shape-radiusLg/);
    expect(cssText).toMatch(/border:\s*1px solid var\(--el-palette-border-lines/);
    expect(cssText).toMatch(/background:\s*var\(--el-palette-background-eliteaDefault/);
    expect(cssText).toMatch(/box-sizing:\s*border-box/);
  });
});
