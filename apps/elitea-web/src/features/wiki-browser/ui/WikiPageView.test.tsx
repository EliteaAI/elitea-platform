import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WikiManifest } from '@/entities/wiki';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { server } from '@/test/setup';

import { WikiPageView } from './WikiPageView';

const BASE = 'http://elitea.test/api/v2';
const OBJECT_ROUTE = `${BASE}/artifacts/objects/:projectId/:bucket/*`;
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

const WIKI: WikiManifest = {
  wiki_id: 'acme--service--main',
  wiki_title: 'Service Wiki',
  pages: ['wiki_pages/architecture/router.md', 'wiki_pages/architecture/storage.md'],
};

function show(wiki: WikiManifest = WIKI) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
        <WikiPageView projectId="7" wiki={wiki} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});
afterEach(() => {
  resetGeneratedClient();
});

describe('WikiPageView', () => {
  it('opens the FIRST page without a click, and asks for it by manifest key', async () => {
    // A list that needs a click before it shows anything reads as an empty
    // screen on a wiki with one page, which is the common case.
    let asked: string | null = null;
    server.use(
      http.get(OBJECT_ROUTE, ({ params }) => {
        asked = String(params['0']);
        return HttpResponse.text('# Router\n\nAssembled in **router.go**.');
      }),
    );

    show();
    // The key is the manifest's wiki_id joined to the path it lists, which is
    // how the provider writes them.
    await waitFor(() => {
      expect(asked).toBe('acme--service--main/wiki_pages/architecture/router.md');
    });
    const content = await screen.findByTestId('wiki-page-content');
    // MARKDOWN, not the literal asterisks.
    expect(content.querySelector('strong')?.textContent).toBe('router.go');
  });

  it('switches page when another is chosen', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(OBJECT_ROUTE, ({ params }) =>
        HttpResponse.text(String(params['0']).includes('storage') ? '# Storage' : '# Router'),
      ),
    );

    show();
    await screen.findByTestId('wiki-page-content');
    await user.click(screen.getByText('wiki_pages/architecture/storage.md'));
    await waitFor(() => {
      expect(screen.getByTestId('wiki-page-content')).toHaveTextContent('Storage');
    });
  });

  it('lists the pages the MANIFEST claims, not what the bucket happens to hold', () => {
    // An index rebuilt from the filesystem would show files the generation
    // never recorded.
    server.use(http.get(OBJECT_ROUTE, () => HttpResponse.text('# Router')));
    show();
    expect(screen.getByText('wiki_pages/architecture/router.md')).toBeVisible();
    expect(screen.getByText('wiki_pages/architecture/storage.md')).toBeVisible();
    expect(screen.queryByText(/orphan/i)).toBeNull();
  });

  it('says a wiki records no pages rather than rendering an empty viewer', async () => {
    show({ ...WIKI, pages: [] });
    expect(await screen.findByTestId('wiki-page-none')).toBeVisible();
    expect(screen.queryByTestId('wiki-page-view')).toBeNull();
  });

  it('reports a page that could not be loaded', async () => {
    server.use(http.get(OBJECT_ROUTE, () => new HttpResponse(null, { status: 500 })));
    show();
    expect(await screen.findByTestId('wiki-page-error')).toBeVisible();
    expect(screen.queryByTestId('wiki-page-content')).toBeNull();
  });

  it('tells a non-text object from a page that says nothing', async () => {
    // Rendering nothing for an object this reader cannot show would look like a
    // page whose content is empty — two different facts.
    server.use(http.get(OBJECT_ROUTE, () => HttpResponse.json({ not: 'text' })));
    show();
    expect(await screen.findByTestId('wiki-page-unreadable')).toBeVisible();
    expect(screen.queryByTestId('wiki-page-content')).toBeNull();
  });
});
