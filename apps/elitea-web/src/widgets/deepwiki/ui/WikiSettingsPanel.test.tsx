import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

import { WikiSettingsPanel } from './WikiSettingsPanel';
import { installCodeMirrorTestPolyfills } from '@/shared/ui/lib/field/codeMirrorTestPolyfills';

// CodeMirror measures DOM ranges on every edit; jsdom has no layout, so the
// same polyfills the editor's own suite installs are needed to type into it.
installCodeMirrorTestPolyfills();

const TOOLKIT = { id: 42, name: 'Wikis', type: 'wikis', description: 'kept' };

async function replaceDraft(_user: ReturnType<typeof userEvent.setup>, text: string) {
  const content = document.querySelector('.cm-content');
  if (!(content instanceof HTMLElement)) throw new Error('no editor');
  // Through the editor's own API, as one transaction. Typing `{` key by key
  // ran CodeMirror's bracket auto-closing into the keystrokes, and a
  // user-event paste reached the CI shard's jsdom with no clipboard data at
  // all — the draft it saved was "" (the CI run received data-field="").
  // The panel reads the draft through CodeMirrorEditor's debounced onChange
  // (30ms), so the dispatch is followed by a wait longer than that.
  const view = EditorView.findFromDOM(content);
  if (view === null) throw new Error('no EditorView behind .cm-content');
  await act(async () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  expect(content).toHaveTextContent(text.slice(0, 12));
}

describe('WikiSettingsPanel', () => {
  it('refuses a draft that is not JSON, against the document', async () => {
    const user = userEvent.setup();
    show(<WikiSettingsPanel projectId="7" toolkitId="42" toolkit={TOOLKIT} settings={{ repository: 'acme/svc' }} />);
    await replaceDraft(user, '{not json');
    const problem = await screen.findByTestId('wiki-settings-problem');
    expect(problem).toHaveAttribute('data-field', '');
    expect(screen.getByTestId('wiki-settings-save')).toBeDisabled();
  });

  it('refuses a configuration with no repository, against the field', async () => {
    // The one check the legacy screen never made; without it a generation
    // runs and finds nothing.
    const user = userEvent.setup();
    show(<WikiSettingsPanel projectId="7" toolkitId="42" toolkit={TOOLKIT} settings={{ repository: 'acme/svc' }} />);
    await replaceDraft(user, '{"llm_model": "gpt-5"}');
    const problem = await screen.findByTestId('wiki-settings-problem');
    expect(problem).toHaveAttribute('data-field', 'repository');
    expect(screen.getByTestId('wiki-settings-save')).toBeDisabled();
  });

  it('PUTs the WHOLE toolkit with the new settings', async () => {
    // The route replaces the resource; a settings-only body would clear every
    // other field the toolkit carries.
    const user = userEvent.setup();
    let body: Record<string, unknown> | null = null;
    server.use(
      http.put(`${BASE}/elitea_core/tool/prompt_lib/:projectId/:toolkitId`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...body, id: 42 });
      }),
    );
    show(<WikiSettingsPanel projectId="7" toolkitId="42" toolkit={TOOLKIT} settings={{ repository: 'acme/svc' }} />);
    await user.click(screen.getByTestId('wiki-settings-save'));
    await screen.findByTestId('wiki-settings-saved');
    expect(body).toMatchObject({ id: 42, name: 'Wikis', description: 'kept', settings: { repository: 'acme/svc' } });
  });

  it('reports a failed save and leaves the draft as typed', async () => {
    const user = userEvent.setup();
    server.use(
      http.put(`${BASE}/elitea_core/tool/prompt_lib/:projectId/:toolkitId`, () =>
        HttpResponse.json({ error: 'nope' }, { status: 500 }),
      ),
    );
    show(<WikiSettingsPanel projectId="7" toolkitId="42" toolkit={TOOLKIT} settings={{ repository: 'acme/svc' }} />);
    await user.click(screen.getByTestId('wiki-settings-save'));
    expect(await screen.findByTestId('wiki-settings-error')).toBeVisible();
    expect(document.querySelector('.cm-content')?.textContent).toContain('acme/svc');
  });
});
