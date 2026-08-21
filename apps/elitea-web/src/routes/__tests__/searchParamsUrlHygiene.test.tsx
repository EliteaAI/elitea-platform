import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContext, RouterContext } from '@/app/router-context';
import { resetConfigForTests } from '@/shared/config/get-config';

import { PARAM_DEFAULTS, PARAM_KEYS, paramSchemas } from '../-search/params';
import { routeTree } from '../../routeTree.gen';

/**
 * What the address bar ends up holding — which no other test in this tree
 * asserts.
 *
 * DEFECT. Every schema in `-search/params.ts` ends in `.prefault(default)`,
 * so `validateSearch` returns every declared key on every call. TanStack
 * Router runs `validateSearch` inside `buildLocation`, and
 * `buildAndCommitLocation` passes `_includeValidateSearch: true`, so the
 * whole defaulted object was written back into the URL on every navigation.
 * One `router.navigate()` produced
 *
 *   /onboarding?author_id=&author_name=&bucket=&conversation=&create=%220%22
 *   &destTab=&...&sort_order=desc&statuses=%5B%5D&tags%5B%5D=%5B%5D&tour=
 *   &view=grid&viewMode=owner&page_size=20
 *
 * and the `/chat` link gave the same shape at 359 characters with 29
 * parameters, none of them chosen by the user. Flag values were re-quoted by
 * `JSON.stringify`, so `0` reached the address bar as `%220%22`. "Parameter
 * absent" became unrepresentable, so every "strip the flag from the URL
 * after use" cleanup put the key straight back as an empty value.
 *
 * `-search/params.test.ts` and `searchParamsMalformed.test.tsx` both
 * exercise PARSING and assert nothing about the emitted URL, which is why
 * this shipped.
 */

const permissiveAuth: AuthContext = {
  getUser: () => ({
    id: 'u1',
    personal_project_id: 'p1',
    permissions: [],
    publicPermissions: [],
  }),
  getSelectedProjectId: () => '999',
};

function buildRouter() {
  return createRouter({
    routeTree,
    basepath: '/app',
    history: createMemoryHistory({ initialEntries: ['/onboarding'] }),
    context: { auth: permissiveAuth } satisfies RouterContext,
  });
}

/**
 * The href a real navigation commits.
 *
 * `buildLocation` alone does NOT reproduce the defect: it defaults
 * `_includeValidateSearch` to false, so a plain call returns a clean href
 * while the address bar carries the bloat. `buildAndCommitLocation` sets the
 * flag to true, so this helper names it explicitly. Read that before
 * "simplifying" any assertion here back to a bare `buildLocation`.
 */
function committedHref(router: ReturnType<typeof buildRouter>, to: string, search?: unknown): string {
  const build = router.buildLocation as unknown as (options: unknown) => { href: string };
  return build({ to, search, _includeValidateSearch: true }).href;
}

beforeEach(() => {
  resetConfigForTests();
  vi.stubEnv('VITE_SERVER_URL', '/api/v2');
  vi.stubEnv('VITE_BASE_URI', '/app/');
  vi.stubEnv('VITE_PUBLIC_PROJECT_ID', '11');
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

describe('emitted search params', () => {
  it('writes no defaulted parameter into the URL', () => {
    const router = buildRouter();

    // `/chat` inherits the 24 shell-wide keys and adds its own. It is the
    // worst case, and it is the URL measured on the live SPA.
    expect(committedHref(router, '/chat')).toBe('/app/chat');
    expect(committedHref(router, '/settings/users')).toBe('/app/settings/users');
    expect(committedHref(router, '/artifacts')).toBe('/app/artifacts');
  });

  it('commits a clean URL through a real navigation', async () => {
    // The strongest form of the assertion above: this is the value the
    // address bar takes, not a computed href.
    const router = buildRouter();
    await router.load();
    await router.navigate({ to: '/onboarding' });
    await router.load();

    expect(router.state.location.href).toBe('/onboarding');
    expect(router.history.location.href).toBe('/app/onboarding');
  });

  it('keeps a parameter the caller actually sets', () => {
    const router = buildRouter();

    expect(committedHref(router, '/chat', { conversation: 'c-1' })).toBe('/app/chat?conversation=c-1');
  });

  it('drops a parameter that is set back to its default', () => {
    // The "strip the flag from the URL after use" case. Before the fix the
    // key came straight back as `create=%220%22`.
    const router = buildRouter();

    expect(committedHref(router, '/chat', { create: '0' })).toBe('/app/chat');
  });

  it('still gives every reader the full defaulted search object', async () => {
    // The URL loses the defaults; the parsed search must NOT. Readers such
    // as `sort_order` and `page_size` have no other source for their value.
    const router = buildRouter();
    await router.load();

    const search = router.state.matches.reduce<Record<string, unknown>>(
      (all, match) => ({ ...all, ...(match.search as Record<string, unknown>) }),
      {},
    );
    expect(search.sort_order).toBe('desc');
    expect(search.page_size).toBe(20);
    expect(search.view).toBe('grid');
    expect(search.viewMode).toBe('owner');
  });

  it('derives every default from its own schema, so the two cannot drift', () => {
    // A hand-written default that disagreed with a schema's `prefault` would
    // strip nothing, silently, and no reader of either file could see it.
    // The map is computed from the schemas, and this proves it stays so.
    for (const key of PARAM_KEYS) {
      expect(PARAM_DEFAULTS[key], `${key} default`).toEqual(paramSchemas[key].parse(undefined));
    }
  });
});
