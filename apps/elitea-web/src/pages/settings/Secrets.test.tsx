/**
 * Regression coverage for a genuine non-terminating render loop found in
 * `SecretsContent` (`Secrets.tsx`).
 *
 * ROOT CAUSE (verified directly, see below): `useListSecretsQuery` returns
 * `UseQueryResult<Secret[], Error>` — `data` is `Secret[] | undefined`. The
 * component used to destructure it as `const { data: secrets = [] } = …`.
 * A destructuring default allocates a BRAND NEW `[]` literal on every
 * render in which `data` is `undefined` — exactly the state the query sits
 * in for as long as it's disabled (no project selected, this file's
 * `projectId` defaults to `''`) or never resolves. That fresh array
 * reference then fed a `useEffect([secrets, isFetching, setRows])`: React
 * saw a "changed" dependency on every render, re-ran the effect, and
 * called `setRows` with a new array reference every time — even though the
 * actual contents ([]) never changed — which triggered a re-render, which
 * allocated a fresh `[]` again, forever.
 *
 * CONFIRMED PRE-FIX: mounting `SecretsContent` with the default (no
 * project selected) `useSelectedProjectStore` state hung the vitest
 * process — `timeout 40 npx vitest run …` had to SIGTERM it (exit 124),
 * matching the reported "CPU pegs at 100%, has to be killed after 30+
 * seconds" symptom exactly. A `Profiler`-based render counter on the same
 * pre-fix mount captured unbounded, linear growth with no sign of
 * levelling off: 500 renders in ~410ms, 5000 renders in ~2.4s (roughly
 * 2000 renders/sec) before the counter's own circuit breaker cut it off.
 *
 * The first `it` below is that same reproduction, kept as a permanent
 * regression test: a `Profiler.onRender` counter with a low, generous
 * circuit-breaker threshold (`RENDER_LIMIT`) that (a) bounds worst-case
 * test runtime even if the bug regresses, since a genuinely runaway loop
 * trips the breaker within tens of milliseconds at the observed rate, and
 * (b) fails with a clear message either way the breaker's throw manifests
 * (some React builds swallow an error thrown from `onRender` rather than
 * propagating it synchronously through `render()` — the `caughtError`
 * re-throw handles the propagating case, the trailing `renderCount`
 * assertion handles the swallowed case).
 */
import { Profiler } from 'react';

import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppProviders } from '@/app/providers/AppProviders';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { useSelectedProjectStore } from '@/widgets/app-shell';
import { server } from '@/test/setup';

import { SecretsContent } from './Secrets';

const BASE = '/api/v2';
const PERMISSIONS_PATH = `${BASE}/auth/permissions/prompt_lib/:projectId`;
const SECRETS_PATH = `${BASE}/secrets/prompt_lib/:projectId`;

/** A generous ceiling no legitimately-settling mount should ever approach. */
const RENDER_LIMIT = 100;

function noop(): void {
  // intentionally empty — satisfies SecretsContentProps.onSearchChange
}

function mountSecretsContent(onRender: () => void): ReturnType<typeof render> {
  return render(
    <AppProviders>
      <Profiler id="secrets-render-guard" onRender={onRender}>
        <SecretsContent shouldCreate={false} search="" onSearchChange={noop} />
      </Profiler>
    </AppProviders>,
  );
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
  useSelectedProjectStore.setState({ project: null });
});

afterEach(() => {
  resetGeneratedClient();
  useSelectedProjectStore.setState({ project: null });
});

describe('SecretsContent — render-loop regression', () => {
  it('does not enter a runaway render loop when no project is selected (query stays disabled forever)', () => {
    let renderCount = 0;
    let caughtError: Error | undefined;

    try {
      mountSecretsContent(() => {
        renderCount += 1;
        if (renderCount > RENDER_LIMIT) {
          throw new Error(
            `Runaway render loop detected: SecretsContent re-rendered ${renderCount} times ` +
              `(limit ${RENDER_LIMIT}) with no project selected — the destructuring-default-into-` +
              'a-dependency-array bug is back.',
          );
        }
      });
    } catch (err) {
      caughtError = err instanceof Error ? err : new Error(String(err));
    }

    if (caughtError) throw caughtError;
    expect(renderCount).toBeLessThan(RENDER_LIMIT);
  });
});

describe('SecretsContent — happy path', () => {
  it('renders the fetched secrets as rows for a real project id', async () => {
    useSelectedProjectStore.setState({ project: { id: 'proj-1', name: 'Acme' } });
    server.use(
      http.get(PERMISSIONS_PATH, () =>
        HttpResponse.json([
          { name: 'configuration.secrets.secret.list', enabled: true },
          { name: 'configuration.secrets.secret.unsecret', enabled: true },
        ]),
      ),
      http.get(SECRETS_PATH, () =>
        HttpResponse.json([
          { name: 'API_KEY', secret_name: 'API_KEY', is_default: false },
          { name: 'DB_PASSWORD', secret_name: 'DB_PASSWORD', is_default: true },
        ]),
      ),
    );

    render(
      <AppProviders>
        <SecretsContent shouldCreate={false} search="" onSearchChange={noop} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('API_KEY').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('DB_PASSWORD').length).toBeGreaterThan(0);
  });
});
