import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { fetchWikiToolkit, listWikiToolkits } from './wikiToolkitApi';

const BASE = 'http://elitea.test/api/v2';
const TOOLKIT_ROUTE = `${BASE}/elitea_core/tool/prompt_lib/:projectId/:toolkitId`;

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});
afterEach(() => {
  resetGeneratedClient();
});

/** Serve one toolkit row per id. */
function serveToolkits(rows: Record<string, unknown>) {
  const seen: string[] = [];
  server.use(
    http.get(TOOLKIT_ROUTE, ({ params }) => {
      const id = String(params['toolkitId']);
      seen.push(id);
      const row = rows[id];
      return row === undefined
        ? HttpResponse.json({ error: 'toolkit not found' }, { status: 404 })
        : HttpResponse.json(row);
    }),
  );
  return seen;
}

describe('fetchWikiToolkit', () => {
  it('reads the repository off the wiki toolkit when it names no code toolkit', async () => {
    serveToolkits({
      '42': { id: 42, name: 'Wikis', type: 'wikis', settings: { repository: 'acme/notes' } },
    });

    const context = await fetchWikiToolkit('7', '42');
    expect(context.identity?.repository).toBe('acme/notes');
    expect(context.settings).toMatchObject({ repository: 'acme/notes' });
  });

  it('FOLLOWS code_toolkit, because that is where the repository actually lives', async () => {
    // The wiki toolkit names an integer; the github toolkit holds the repo.
    // Not following it filters the wiki list against the wrong repository,
    // which renders as "you have no wikis" rather than as an error.
    const seen = serveToolkits({
      '42': { id: 42, type: 'wikis', settings: { code_toolkit: 9, llm_model: 'gpt-5' } },
      '9': { id: 9, type: 'github', settings: { repository: 'acme/service', branch: 'main' } },
    });

    const context = await fetchWikiToolkit('7', '42');
    expect(seen).toEqual(['42', '9']);
    expect(context.identity?.repository).toBe('acme/service');
    // The WIKI toolkit's settings are what comes back, not the code toolkit's:
    // llm_model and max_tokens belong to the wiki and drive every invocation.
    expect(context.settings).toMatchObject({ code_toolkit: 9, llm_model: 'gpt-5' });
  });

  it('falls back to the wiki toolkit when the reference cannot be followed', async () => {
    // The legacy bundle warns and carries on (DeepWikiApp.jsx:793-810). A
    // deleted code toolkit must not take the whole screen down with it.
    serveToolkits({
      '42': { id: 42, type: 'wikis', settings: { code_toolkit: 404, repository: 'acme/fallback' } },
    });

    const context = await fetchWikiToolkit('7', '42');
    expect(context.identity?.repository).toBe('acme/fallback');
  });

  it('reads toolkit_config when there is no settings object', async () => {
    // The SETTINGS are what this asserts, not the identity. The identity is
    // resolved from the toolkit either way — `getConfiguredRepoIdentity` merges
    // `toolkit_config` itself — so asserting it passes whether the fallback is
    // here or not. The settings are what drive every invocation: an empty
    // object here sends a request with no llm_model, which the provider refuses
    // with a message about a field the user did set.
    serveToolkits({
      '42': {
        id: 42,
        type: 'wikis',
        toolkit_config: { repository: 'acme/cfg', llm_model: 'gpt-5' },
      },
    });
    const context = await fetchWikiToolkit('7', '42');
    expect(context.settings).toMatchObject({ repository: 'acme/cfg', llm_model: 'gpt-5' });
    expect(context.identity?.repository).toBe('acme/cfg');
  });

  it('reports no identity rather than inventing one', async () => {
    // A toolkit that names no repository is a real state — a wiki configured
    // but not yet pointed anywhere — and the browser shows every wiki in the
    // bucket for it rather than an error.
    serveToolkits({ '42': { id: 42, type: 'wikis', settings: {} } });
    const context = await fetchWikiToolkit('7', '42');
    expect(context.identity).toBeNull();
  });

  it('unwraps the transport envelope', async () => {
    // Reading the toolkit off the envelope gives an object whose fields are
    // all undefined on a 200 — the #132 shape, which happened twice on one
    // endpoint.
    server.use(
      http.get(TOOLKIT_ROUTE, () =>
        HttpResponse.json({ id: 42, type: 'wikis', settings: { repository: 'acme/env' } }),
      ),
    );
    const context = await fetchWikiToolkit('7', '42');
    expect(context.identity?.repository).toBe('acme/env');
  });
});

describe('listWikiToolkits', () => {
  const LIST_ROUTE = `${BASE}/elitea_core/tools/prompt_lib/:projectId`;

  it('keeps only the wiki toolkits, and reads them off the envelope', async () => {
    // The listing carries every toolkit a project has. Rendering all of them
    // as wikis would offer a github toolkit as something to browse.
    server.use(
      http.get(LIST_ROUTE, () =>
        HttpResponse.json({
          rows: [
            { id: 1, type: 'github', name: 'Code' },
            { id: 42, type: 'wikis', name: 'Service wiki' },
            { id: 43, type: 'Wikis', name: 'Docs wiki' },
          ],
          total: 3,
        }),
      ),
    );

    // The type match is case-insensitive: the descriptor spells the toolkit
    // `Wikis` and the SPI path spells it `wikis`, so both reach storage.
    await expect(listWikiToolkits('7')).resolves.toEqual([
      { id: '42', name: 'Service wiki' },
      { id: '43', name: 'Docs wiki' },
    ]);
  });

  it('falls back to the id when a row has no name', async () => {
    // The id is the toolkit's address. Hiding a row over a missing label makes
    // a wiki unreachable.
    server.use(
      http.get(LIST_ROUTE, () => HttpResponse.json({ rows: [{ id: 42, type: 'wikis' }] })),
    );
    await expect(listWikiToolkits('7')).resolves.toEqual([{ id: '42', name: '42' }]);
  });

  it('drops a row with no id, which has no address to offer', async () => {
    server.use(
      http.get(LIST_ROUTE, () =>
        HttpResponse.json({ rows: [{ type: 'wikis', name: 'nowhere' }] }),
      ),
    );
    await expect(listWikiToolkits('7')).resolves.toEqual([]);
  });

  it('reads an empty listing as no wikis rather than throwing', async () => {
    server.use(http.get(LIST_ROUTE, () => HttpResponse.json({ rows: [], total: 0 })));
    await expect(listWikiToolkits('7')).resolves.toEqual([]);
    server.use(http.get(LIST_ROUTE, () => HttpResponse.json({})));
    await expect(listWikiToolkits('7')).resolves.toEqual([]);
  });
});
