import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { selectPersonalProjectId, useResolvedSharepointConfig } from './useResolvedSharepointConfig.hooks';
import type { SharepointConfigRef } from './useResolvedSharepointConfig.hooks';

describe('selectPersonalProjectId (pure)', () => {
  it('reads auth.getUser().personal_project_id when present', () => {
    const context = { auth: { getUser: () => ({ personal_project_id: 'personal-1' }) } };
    expect(selectPersonalProjectId(context)).toBe('personal-1');
  });

  it('returns undefined when getUser() returns undefined', () => {
    const context = { auth: { getUser: () => undefined } };
    expect(selectPersonalProjectId(context)).toBeUndefined();
  });

  it('returns undefined when context has no auth field', () => {
    expect(selectPersonalProjectId({})).toBeUndefined();
  });

  it('returns undefined for non-object input', () => {
    expect(selectPersonalProjectId(undefined)).toBeUndefined();
    expect(selectPersonalProjectId(null)).toBeUndefined();
  });
});

function ProbeComponent({ spConfigRef, projectId }: { spConfigRef: SharepointConfigRef | undefined; projectId: string | undefined }) {
  const result = useResolvedSharepointConfig(spConfigRef, projectId);
  return (
    <output>
      {JSON.stringify({
        oauthEndpoint: result.oauthEndpoint,
        configUuid: result.configUuid,
        connectionTokenKey: result.connectionTokenKey,
        siteUrl: result.spConfig?.site_url ?? null,
      })}
    </output>
  );
}

function renderProbe(
  spConfigRef: SharepointConfigRef | undefined,
  projectId: string | undefined,
  personalProjectId: string | undefined = undefined,
) {
  const rootRoute = createRootRoute({ component: () => <ProbeComponent spConfigRef={spConfigRef} projectId={projectId} /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getUser: () => ({ personal_project_id: personalProjectId }) } },
  });
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useResolvedSharepointConfig', () => {
  it('resolves nothing when spConfigRef has no elitea_title', async () => {
    renderProbe(undefined, 'proj-1');
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('"oauthEndpoint":""');
    });
  });

  it('fetches by type=sharepoint for the given projectId and resolves the matching credential by elitea_title', async () => {
    server.use(
      http.get('*/api/v2/configurations/configurations/proj-1', ({ request }) => {
        expect(new URL(request.url).searchParams.get('type')).toBe('sharepoint');
        return HttpResponse.json({
          items: [
            {
              id: '1',
              type: 'sharepoint',
              uuid: 'uuid-1',
              elitea_title: 'My SP',
              data: { oauth_discovery_endpoint: 'https://login.microsoftonline.com/tenant', site_url: 'https://contoso.sharepoint.com' },
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
        });
      }),
    );

    renderProbe({ elitea_title: 'My SP' }, 'proj-1');

    await waitFor(() => {
      const text = screen.getByRole('status').textContent ?? '';
      expect(JSON.parse(text)).toMatchObject({
        oauthEndpoint: 'https://login.microsoftonline.com/tenant',
        configUuid: 'uuid-1',
        connectionTokenKey: 'uuid-1:https://login.microsoftonline.com/tenant',
      });
    });
  });

  it('uses the personal project id (not the passed-in projectId) when spConfigRef.private is true', async () => {
    server.use(
      http.get('*/api/v2/configurations/configurations/personal-1', () =>
        HttpResponse.json({
          items: [{ id: '1', type: 'sharepoint', uuid: 'uuid-2', elitea_title: 'Private SP', data: { site_url: 'https://private.sharepoint.com' } }],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      ),
      http.get('*/api/v2/configurations/configurations/proj-1', () => HttpResponse.json({ items: [], total: 0, limit: 20, offset: 0 })),
    );

    renderProbe({ elitea_title: 'Private SP', private: true }, 'proj-1', 'personal-1');

    await waitFor(() => {
      const text = screen.getByRole('status').textContent ?? '';
      expect(JSON.parse(text)).toMatchObject({ siteUrl: 'https://private.sharepoint.com' });
    });
  });

  it(
    'skips the fetch when eliteaTitle is an empty string ' +
      '(baseline: `{ skip: !eliteaTitle || !credProjectId }` — falsy, not undefined-only)',
    async () => {
      let requestCount = 0;
      server.use(
        http.get('*/api/v2/configurations/configurations/*', () => {
          requestCount += 1;
          return HttpResponse.json({ items: [], total: 0, limit: 20, offset: 0 });
        }),
      );

      renderProbe({ elitea_title: '' }, 'proj-1');

      // Give an (incorrectly fired) fetch a chance to land before asserting it didn't.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(requestCount).toBe(0);
    },
  );

  it(
    'skips the fetch when the resolved credProjectId is an empty string ' +
      '(baseline: `{ skip: !eliteaTitle || !credProjectId }` — an empty personal_project_id must also skip)',
    async () => {
      let requestCount = 0;
      server.use(
        http.get('*/api/v2/configurations/configurations/*', () => {
          requestCount += 1;
          return HttpResponse.json({ items: [], total: 0, limit: 20, offset: 0 });
        }),
      );

      renderProbe({ elitea_title: 'Private SP', private: true }, 'proj-1', '');

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(requestCount).toBe(0);
    },
  );

  it('resolves an unmatched elitea_title to no config (spConfig stays null)', async () => {
    server.use(
      http.get('*/api/v2/configurations/configurations/proj-1', () =>
        HttpResponse.json({ items: [{ id: '1', type: 'sharepoint', elitea_title: 'Other', data: {} }], total: 1, limit: 20, offset: 0 }),
      ),
    );

    renderProbe({ elitea_title: 'Not Found' }, 'proj-1');

    await waitFor(() => {
      const text = screen.getByRole('status').textContent ?? '';
      expect(JSON.parse(text)).toMatchObject({ oauthEndpoint: '', siteUrl: null });
    });
  });
});
