import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { server } from '@/test/setup';

const BASE = 'http://elitea.test/api/v2';
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function Wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}

function show(ui: React.ReactElement) {
  return render(ui, { wrapper: Wrapper });
}

beforeEach(() => {
  window.localStorage.clear();
  configureGeneratedClient({ baseUrl: BASE });
});
afterEach(() => {
  resetGeneratedClient();
});

import { WikiPageReader } from './WikiPageReader';

const PROJECT = '7';
const KEY = 'acme--svc--main/wiki_pages/overview/getting-started.md';
const BROKEN = 'graph TD\n  A -->';
const FIXED = 'graph TD\n  A --> B';
const PAGE = `# Overview\n\nIntro text.\n\n\`\`\`mermaid\n${BROKEN}\n\`\`\`\n\nAfter text.\n`;
const MODELS_OK = { low_tier_default_model_name: 'small', low_tier_default_model_project_id: '7' };
const PROMPT_OK = { items: [{ data: { key: 'MERMAID_QUICK_FIX', prompt: 'Repair this diagram.' } }] };
/** mermaid parses in jsdom, but slowly on a cold engine — the same budget MermaidDiagram's own suite uses. */
const MERMAID_TIMEOUT = 15000;

/** The two capability reads the quick-fix hook makes, plus the model reply that repairs the block. */
function installQuickFix(): void {
  server.use(
    http.get(`${BASE}/configurations/models/${PROJECT}`, () => HttpResponse.json(MODELS_OK)),
    http.get(`${BASE}/configurations/configurations/${PROJECT}`, () => HttpResponse.json(PROMPT_OK)),
    http.post(`${BASE}/elitea_core/predict_llm/prompt_lib/${PROJECT}`, () =>
      HttpResponse.json({ result: { output: `\`\`\`mermaid\n${FIXED}\n\`\`\`` } }),
    ),
  );
}

/** Records every page save; `status` lets a test make the route refuse. */
type AppendSpy = MockInstance<FormData['append']>;

function installSave(status = 201): { urls: string[]; append: AppendSpy } {
  const urls: string[] = [];
  server.use(
    http.post(`${BASE}/artifacts/objects/:projectId/:bucket`, ({ request }) => {
      urls.push(request.url);
      return status === 201
        ? HttpResponse.json({ key: KEY }, { status })
        : HttpResponse.json({ error: 'bucket is read-only' }, { status });
    }),
  );
  // Fields are asserted at the append call: under vitest's jsdom the wire
  // filename degrades to "blob" (see WikiPageEditor.test.tsx).
  return { urls, append: vi.spyOn(FormData.prototype, 'append') };
}

async function appendedText(append: AppendSpy, call: number): Promise<string> {
  const [, part, filename] = append.mock.calls[call] ?? [];
  expect(filename).toBe(KEY);
  return (part as Blob).text();
}

/** Renders the page and waits for mermaid to reject the broken block, which is what surfaces the quick fix. */
async function renderBrokenPage(): Promise<void> {
  show(<WikiPageReader projectId={PROJECT} pageKey={KEY} markdown={PAGE} />);
  await waitFor(() => expect(screen.getByTestId('canvas-mermaid-quick-fix')).toBeInTheDocument(), {
    timeout: MERMAID_TIMEOUT,
  });
}

describe('WikiPageReader', () => {
  it('follows the page when it is re-read underneath — an editor save must show without a reload', () => {
    installQuickFix();
    const view = show(<WikiPageReader projectId={PROJECT} pageKey={KEY} markdown="# Before" />);
    expect(screen.getByText('Before')).toBeInTheDocument();
    view.rerender(<WikiPageReader projectId={PROJECT} pageKey={KEY} markdown="# After the save" />);
    expect(screen.getByText('After the save')).toBeInTheDocument();
    expect(screen.queryByText('Before')).toBeNull();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('interleaves the prose with one diagram block per mermaid fence', async () => {
    installQuickFix();
    await renderBrokenPage();
    expect(screen.getByText('Intro text.')).toBeInTheDocument();
    expect(screen.getByText('After text.')).toBeInTheDocument();
    expect(screen.getAllByTestId('wiki-mermaid-block')).toHaveLength(1);
  }, MERMAID_TIMEOUT + 5000);

  it('shows the proposed fix as a diff and discards it without saving', async () => {
    installQuickFix();
    const { urls } = installSave();
    const user = userEvent.setup();
    await renderBrokenPage();

    await user.click(screen.getByTestId('canvas-mermaid-quick-fix'));
    const diff = await screen.findByTestId('wiki-fix-diff');
    expect(diff.querySelectorAll('[data-diff-kind]').length).toBeGreaterThan(0);
    expect(diff).toHaveTextContent('A --> B');

    await user.click(screen.getByTestId('wiki-fix-reject'));
    await waitFor(() => expect(screen.queryByTestId('wiki-fix-diff')).toBeNull());
    expect(urls).toHaveLength(0);
    // The block is still the broken one, so the fix is still on offer.
    expect(screen.getByTestId('canvas-mermaid-quick-fix')).toBeInTheDocument();
  }, MERMAID_TIMEOUT + 5000);

  it('accepting saves the repaired page over the key, and undo saves the original back', async () => {
    installQuickFix();
    const { urls, append } = installSave();
    const user = userEvent.setup();
    await renderBrokenPage();

    await user.click(screen.getByTestId('canvas-mermaid-quick-fix'));
    await user.click(await screen.findByTestId('wiki-fix-accept'));

    await waitFor(() => expect(urls).toHaveLength(1));
    expect(urls[0]).toContain('overwrite=true');
    const saved = await appendedText(append, 0);
    expect(saved).toContain(FIXED);
    expect(saved).not.toContain(BROKEN + '\n```');
    // Prose around the block is untouched by the replacement.
    expect(saved).toContain('# Overview');
    expect(saved).toContain('After text.');
    expect(screen.getByTestId('wiki-page-feedback')).toHaveTextContent('Diagram fixed and saved.');
    // The repaired diagram parses, so the offer disappears.
    await waitFor(() => expect(screen.queryByTestId('canvas-mermaid-quick-fix')).toBeNull(), {
      timeout: MERMAID_TIMEOUT,
    });

    await user.click(screen.getByTestId('wiki-fix-undo'));
    await waitFor(() => expect(urls).toHaveLength(2));
    expect(await appendedText(append, 1)).toBe(PAGE);
    await waitFor(() => expect(screen.queryByTestId('wiki-fix-undo')).toBeNull());
    expect(screen.getByTestId('wiki-page-feedback')).toHaveTextContent('undone');
  }, MERMAID_TIMEOUT * 2 + 5000);

  it('a refused save keeps the review open and says why', async () => {
    installQuickFix();
    installSave(500);
    const user = userEvent.setup();
    await renderBrokenPage();

    await user.click(screen.getByTestId('canvas-mermaid-quick-fix'));
    await user.click(await screen.findByTestId('wiki-fix-accept'));

    await waitFor(() => expect(screen.getByTestId('wiki-page-feedback')).toHaveTextContent('could not be saved'));
    expect(screen.getByTestId('wiki-fix-accept')).toBeInTheDocument();
    expect(screen.queryByTestId('wiki-fix-undo')).toBeNull();
  }, MERMAID_TIMEOUT + 5000);
});
