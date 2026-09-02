import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { server } from '@/test/setup';

const BASE = 'http://elitea.test/api/v2';
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function show(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  configureGeneratedClient({ baseUrl: BASE });
});
afterEach(() => {
  resetGeneratedClient();
});

import { WikiPageEditor } from './WikiPageEditor';
import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';

// CodeMirror measures DOM ranges on every edit; jsdom has no layout, so the
// same polyfills the editor's own suite installs are needed to type into it.
installCodeMirrorTestPolyfills();

const KEY = 'acme--svc--main/wiki_pages/overview/getting-started.md';

describe('WikiPageEditor', () => {
  it('saves the draft as a multipart object under the page key, replacing it', async () => {
    const user = userEvent.setup();
    let seenUrl: string | null = null;
    server.use(
      http.post(`${BASE}/artifacts/objects/:projectId/:bucket`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({ key: KEY }, { status: 201 });
      }),
    );
    // The multipart FIELDS are asserted at the append call, not by parsing the
    // wire: under vitest's jsdom the global `File` is jsdom's while undici's
    // parser and serializer only recognise their own, so a server-side
    // `request.formData()` throws and the wire filename degrades to "blob"
    // (see src/test/msw/handlers/upload.ts — the same gap, same workaround).
    const append = vi.spyOn(FormData.prototype, 'append');
    const onSaved = vi.fn();
    const onClose = vi.fn();
    show(<WikiPageEditor open onClose={onClose} projectId="7" pageKey={KEY} markdown="# Old" onSaved={onSaved} />);

    await user.click(screen.getByTestId('wiki-page-editor-save'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // overwrite=true: every save REPLACES, and the route answers 409 without it.
    expect(seenUrl).toContain('overwrite=true');
    const [field, part, filename] = append.mock.calls[0] ?? [];
    expect(field).toBe('file');
    // The page key is the part's filename, slashes intact — the server keys
    // the object by it; a File named "getting-started.md" would land at the root.
    expect(filename).toBe(KEY);
    expect(part).toBeInstanceOf(Blob);
    expect(await (part as Blob).text()).toBe('# Old');
    expect(onSaved).toHaveBeenCalledWith('# Old');
  });

  it('keeps the editor OPEN with the reason when the save fails', async () => {
    // The acceptance criterion names this: an editor that closes on error
    // looks exactly like one that saved.
    const user = userEvent.setup();
    server.use(
      http.post(`${BASE}/artifacts/objects/:projectId/:bucket`, () =>
        HttpResponse.json({ error: 'bucket is read-only' }, { status: 500 }),
      ),
    );
    const onClose = vi.fn();
    show(<WikiPageEditor open onClose={onClose} projectId="7" pageKey={KEY} markdown="# Old" />);

    await user.click(screen.getByTestId('wiki-page-editor-save'));

    expect(await screen.findByTestId('wiki-page-editor-error')).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('wiki-page-editor-save')).toBeEnabled();
  });
});
