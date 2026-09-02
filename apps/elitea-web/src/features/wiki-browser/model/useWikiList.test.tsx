/**
 * useWikiList: what it loads, and what it refuses to show.
 *
 * THE FIXTURES ARE THE RECORDED PROVIDER'S. wiki-object-list.200.json and
 * wiki-manifest.200.json carry keys and a manifest body produced by EXECUTING
 * the legacy plugin (phase-P0 conformance recording), wrapped in elitea-main's
 * own ListObjects envelope. Inventing shapes here would test this hook against
 * a store that does not exist.
 *
 * THE SECOND TEST IS THE ONE THAT MATTERS. A bucket holds every wiki any
 * project generated, so a hook that returned everything it listed would show a
 * project its neighbour's wikis. The repository filter is what prevents that,
 * and this asserts it runs — not that it exists.
 */
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import objectList200 from '@/test/msw/fixtures/deepwiki/wiki-object-list.200.json';
import manifest200 from '@/test/msw/fixtures/deepwiki/wiki-manifest.200.json';

import { renderHookWithProviders } from '../__tests__/testUtils';
import { useWikiList } from './useWikiList';

const PROJECT = '1';
const BUCKET = 'wiki-artifacts';
const OBJECTS = `/api/v2/artifacts/objects/${PROJECT}/${BUCKET}`;

/** The identity the recorded manifest belongs to. */
const OWN_IDENTITY = { repository: 'acme/notes-service', branch: 'main' };

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

function serveBucket(manifestBody: object = manifest200.body): void {
  server.use(
    http.get(OBJECTS, () => HttpResponse.json(objectList200.body)),
    http.get(`${OBJECTS}/*`, () => HttpResponse.json(manifestBody)),
  );
}

describe('useWikiList', () => {
  it('loads the manifests the bucket lists', async () => {
    serveBucket();
    const { result } = renderHookWithProviders(() => useWikiList(PROJECT, OWN_IDENTITY));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.allWikis).toHaveLength(1);
    expect(result.current.data?.allWikis[0]?.wiki_id).toBe('acme--notes-service--main');
  });

  it('does not return a wiki belonging to a different repository', async () => {
    serveBucket();
    const { result } = renderHookWithProviders(() =>
      useWikiList(PROJECT, { repository: 'other-org/other-service', branch: 'main' }),
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    // The bucket listed one wiki and it is not this project's.
    expect(result.current.data?.allWikis).toHaveLength(1);
    expect(result.current.data?.wikis).toEqual([]);
  });

  it('returns nothing at all when no repository is configured', async () => {
    serveBucket();
    const { result } = renderHookWithProviders(() => useWikiList(PROJECT, null));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.wikis).toEqual([]);
  });

  it('does not fetch while disabled', async () => {
    let requests = 0;
    server.use(
      http.get(OBJECTS, () => {
        requests += 1;
        return HttpResponse.json(objectList200.body);
      }),
    );
    const { result } = renderHookWithProviders(() =>
      useWikiList(PROJECT, OWN_IDENTITY, { enabled: false }),
    );

    // The capability flag is off by default, so this is the state the route
    // actually renders in today. A hook that fetched anyway would put requests
    // on the wire for a feature the build says it does not serve.
    await waitFor(() => {
      expect(result.current.fetchStatus).toBe('idle');
    });
    expect(requests).toBe(0);
  });
});
